package main

import "testing"

func TestDesiredShapeHierarchy(t *testing.T) {
	cases := []struct {
		name string
		in   windowInputs
		want windowShape
	}{
		{"menu open", windowInputs{open: true, layer: true, gestures: true}, shapeLayer},
		{"gesture control page open", windowInputs{open: true, layer: false, gestures: true}, shapeWindow},
		{"hidden with gestures on: camera bubble", windowInputs{layer: true, gestures: true}, shapeBubble},
		{"hidden without gestures", windowInputs{layer: true}, shapeHidden},
		{"gesture menu over the open layer", windowInputs{open: true, layer: true, gestures: true, gestureScreen: true}, shapeGestureScreen},
		{"gesture menu from the bubble", windowInputs{gestures: true, gestureScreen: true}, shapeGestureScreen},
		{"gesture menu while the camera is paused (PDF Scanner)", windowInputs{open: true, layer: true, gestureScreen: true}, shapeLayer},
		{"summary over everything", windowInputs{open: true, layer: true, gestures: true, gestureScreen: true, summary: true}, shapeSummary},
	}
	for _, c := range cases {
		if got := desiredShape(c.in); got != c.want {
			t.Errorf("%s: got %s, want %s", c.name, got, c.want)
		}
	}
}

// The bugs of fix R5: a temporary shape must end in exactly the shape that was there before.
func TestTemporaryShapesReturnToWhatWasThere(t *testing.T) {
	for _, base := range []windowInputs{
		{open: true, layer: true, gestures: true},  // reading a document in the layer
		{open: true, layer: false, gestures: true}, // Gesture Control's page
		{gestures: true}, // only the bubble
	} {
		before := desiredShape(base)
		menu := base
		menu.gestureScreen = true
		if desiredShape(menu) != shapeGestureScreen {
			t.Fatalf("%+v: the gesture menu did not open", base)
		}
		menu.gestureScreen = false
		if got := desiredShape(menu); got != before {
			t.Errorf("%+v: after the gesture menu got %s, want %s (it used to fall back to a 960x680 window)", base, got, before)
		}
	}
	// The summary closes and hides the overlay: back to the bubble if the gestures are on.
	in := windowInputs{open: true, layer: true, gestures: true, summary: true}
	in.summary, in.open = false, false
	if got := desiredShape(in); got != shapeBubble {
		t.Errorf("after the summary got %s, want bubble", got)
	}
}
