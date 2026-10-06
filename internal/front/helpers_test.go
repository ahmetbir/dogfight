package front

// The server's user-facing texts the integration tests compare (core/server's
// unexported msg* constants, copied: the wire must not change).
const (
	msgNoRoom   = "oda bulunamadı"
	msgBad      = "geçersiz mesaj"
	msgJoins    = "çok fazla deneme, biraz bekle"
	msgUpdating = "sunucu güncelleniyor, yeniden bağlan"
)
