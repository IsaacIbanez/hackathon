// Markup of the Gesture Control camera page (styles in gestureControl.css).
export const MARKUP = `
    <header>
      <div class="brand">
        <div class="logo" aria-hidden="true">✋</div>
        <div>
          <h1>Gesture Control</h1>
          <p id="status" role="status">Connecting to the helper…</p>
        </div>
      </div>
      <label class="power"><input type="checkbox" id="enabled" checked /> <span id="enabledLabel">On</span></label>
    </header>

    <div class="stage" id="stage">
      <video id="video" autoplay playsinline muted></video>
      <canvas id="canvas" aria-label="Camera view with hand tracking"></canvas>
      <div id="action" aria-live="assertive"></div>
      <div id="sleep" role="status" hidden></div>
      <div id="menu" hidden>
        <div class="op" data-s="up_left" style="grid-area: ul"></div>
        <div class="op" data-s="up" style="grid-area: up"></div>
        <div class="op" data-s="up_right" style="grid-area: ur"></div>
        <div class="op" data-s="left" style="grid-area: left"></div>
        <div class="center"><strong id="menuTitle">Menu</strong>☝️ Point at an option and tap<br />middle finger on thumb · ✊ closes</div>
        <div class="op" data-s="right" style="grid-area: right"></div>
        <div class="op" data-s="down_left" style="grid-area: dl"></div>
        <div class="op" data-s="down" style="grid-area: down"></div>
        <div class="op" data-s="down_right" style="grid-area: dr"></div>
      </div>
      <div id="cursor" hidden></div>
    </div>

    <div class="controls">
      <div class="seg" id="context" role="group" aria-label="Mode">
        <button data-c="call" aria-pressed="true">📞 Video call</button>
        <button data-c="pc" aria-pressed="false">💻 Computer</button>
      </div>
      <select id="app" aria-label="Video call app">
        <option value="meet">Google Meet</option>
        <option value="zoom">Zoom</option>
        <option value="teams">Microsoft Teams</option>
      </select>
      <label class="check"><input type="checkbox" id="mouse" checked /> Move the mouse with ☝️ (middle/heart finger + thumb clicks)</label>
    </div>

    <section class="card">
      <h2>Gestures · <span id="contextName">Video call</span></h2>
      <table id="guide"></table>
    </section>
    <section class="card">
      <h2>Done</h2>
      <ol id="log"></ol>
    </section>
    <p class="hint">Keep this window open (it can sit behind the call). The call app should be open; shortcuts go to its window.
      The detector sleeps after a few seconds without gestures: show an open palm, fingers spread, to wake it.</p>
    
`;
