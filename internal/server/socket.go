package server

import (
	"context"
	"errors"
	"net/http"

	"playground/internal/limit"
	"playground/internal/protocol"
	"playground/internal/room"
	"playground/internal/sim"
	"playground/internal/wsconn"
)

// User-facing error texts.
const (
	msgVersion  = "sürüm uyuşmuyor, sayfayı yenile"
	msgNoRoom   = "oda bulunamadı"
	msgBadRoom  = "geçersiz oda ayarı"
	msgFull     = "oda dolu"
	msgBad      = "geçersiz mesaj"
	msgNoCreate = "oda kurulamadı"
	msgBusy     = "sunucu dolu"
	msgCreates  = "çok fazla oda kurdun, biraz bekle"
	msgJoins    = "çok fazla deneme, biraz bekle"
	msgFlood    = "çok fazla mesaj"
	msgConns    = "çok fazla bağlantı"
)

var (
	errTimeout = errors.New("server: handshake timeout")
	errFlood   = errors.New("server: message rate exceeded")
	errDropped = errors.New("server: input over its rate, dropped")
)

// floodError is errFlood naming the bucket that refused and the message type.
type floodError struct{ bucket, typ string }

func (e floodError) Error() string        { return errFlood.Error() + ": " + e.bucket + " bucket, " + e.typ }
func (e floodError) Is(target error) bool { return target == errFlood }

// peer is one game socket: its connection, its address and its limits.
type peer struct {
	conn  *wsconn.Conn
	ip    string // for logs
	key   string // for per-address limits
	guard *msgGuard
	latch presses // one-shot presses of dropped inputs
	drops dropLog // inputs dropped over their rate
}

func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	ip := clientIP(r, s.o.TrustProxy)
	p := &peer{ip: ip.String(), key: limitKey(ip), guard: newMsgGuard(s.o.Limits, s.o.Now)}
	if err := s.conns.Acquire(p.key); err != nil {
		if errors.Is(err, limit.ErrKey) {
			s.rejects.note("conns-per-ip", p.ip)
			http.Error(w, msgConns, http.StatusTooManyRequests)
		} else {
			s.rejects.note("conns-total", p.ip)
			http.Error(w, msgBusy, http.StatusServiceUnavailable)
		}
		return
	}
	s.connsGauge(1)
	defer func() { s.conns.Release(p.key); s.connsGauge(-1) }()
	s.sockets.Add(1) // before the upgrade: Shutdown still tracks this request
	defer s.sockets.Done()

	conn, err := wsconn.Accept(w, r, wsconn.Options{Lag: s.o.Lag, Origins: s.o.Origins, Count: s.counters()})
	if err != nil {
		return // Accept has written the HTTP error
	}
	defer conn.Wait()
	p.conn = conn
	ctx, cancel := context.WithTimeout(r.Context(), s.o.HandshakeTimeout)
	seat, msg := s.handshake(ctx, p)
	cancel()
	if msg != "" {
		fail(conn, msg)
		return
	}
	defer seat.Leave()
	if msg := s.pump(p, seat); msg != "" {
		fail(conn, msg)
		return
	}
	conn.Close()
}

// fail sends a final error message and closes with StatusPolicyViolation.
func fail(conn *wsconn.Conn, msg string) {
	conn.Fail(protocol.NewError(msg))
	<-conn.Done()
}

// next decodes one inbound message within the connection's rate limits:
// errDropped for an input over its rate, a floodError for anything else.
func (s *Server) next(p *peer, b []byte) (protocol.ClientMsg, error) {
	if s.o.Metrics != nil {
		s.o.Metrics.MsgsIn.Inc()
	}
	if v, lim := p.guard.frame(len(b)); v == kick {
		return protocol.ClientMsg{}, floodError{lim, "any"}
	}
	m, err := protocol.DecodeClient(b)
	if err != nil {
		return m, err
	}
	switch v, bucket := p.guard.check(m.T); v {
	case drop:
		return m, errDropped
	case kick:
		return m, floodError{bucket, m.T}
	}
	return m, nil
}

// admit is next for the game: an input over its rate is dropped (ok false)
// and its one-shot presses carry over to the next admitted input.
func (s *Server) admit(p *peer, b []byte) (m protocol.ClientMsg, ok bool, err error) {
	m, err = s.next(p, b)
	switch {
	case errors.Is(err, errDropped):
		p.latch.keep(m)
		p.drops.note(p.guard.now(), p.ip)
		return m, false, nil
	case err != nil:
		return m, false, err
	}
	if m.T == protocol.TIn {
		p.latch.into(&m)
	}
	return m, true, nil
}

func (s *Server) msgOf(err error, p *peer) string {
	switch {
	case errors.Is(err, errFlood):
		var fe floodError
		errors.As(err, &fe)
		s.rejects.note("flood", p.ip, "bucket", fe.bucket, "type", fe.typ)
		return msgFlood
	case errors.Is(err, errTimeout), errors.Is(err, context.DeadlineExceeded):
		return "zaman aşımı"
	}
	return msgBad
}

// pump forwards in-game messages to the room until the connection or the
// room ends. It returns an error text for a message that breaks protocol
// or the connection's rate limits.
func (s *Server) pump(p *peer, seat *room.Seat) string {
	defer p.drops.flush(p.ip)
	done := seat.Done()
	for {
		select {
		case <-done:
			return ""
		case b, ok := <-p.conn.Recv():
			if !ok {
				return ""
			}
			m, ok, err := s.admit(p, b)
			if err != nil {
				return s.msgOf(err, p)
			}
			if !ok {
				continue
			}
			switch m.T {
			case protocol.TIn, protocol.TPing, protocol.TChat, protocol.TTeam: // team: DecodeClient whitelisted it
			case protocol.TPick:
				if _, ok := sim.ParseKind(m.Kind); !ok {
					return msgBad
				}
			default:
				return msgBad
			}
			seat.Input(m)
		}
	}
}
