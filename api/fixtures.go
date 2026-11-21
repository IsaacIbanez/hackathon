// Package api exposes the example messages (fixtures) of the contract.
// The generated types live in the gen subpackage.
package api

import "embed"

// Fixtures holds api/fixtures/*.json, one example of each WebSocket message.
//
//go:embed fixtures/*.json
var Fixtures embed.FS
