package sim

// Test-only access for the external sim_test package (AA loiter harness).

func (w *World) PlaceForTest(id ID, fs FlightState) { w.setFlight(id, fs) }
func (w *World) UnprotectForTest()                  { w.clearProtection() }
