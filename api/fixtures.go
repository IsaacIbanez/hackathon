// Package api expone los ejemplos de mensajes (fixtures) del contrato.
// Los tipos generados están en el subpaquete gen.
package api

import "embed"

// Fixtures contiene api/fixtures/*.json, un ejemplo de cada mensaje del WebSocket.
//
//go:embed fixtures/*.json
var Fixtures embed.FS
