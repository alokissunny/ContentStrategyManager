// ASS is a data format, not a prompt: discard override syntax from model/source
// text so captions cannot inject positions, files or subtitle drawing commands.
const safe = text => String(text || '').replace(/[\\{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
const stamp = value => { const cs = Math.round(Math.max(0, value) * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
function podcastSubtitles(plan, width, height) {
  const fontSize = width < height ? 32 : 34;
  const lines = [`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Arial,${fontSize},&H00FFFFFF,&H0000FFFF,&H00181818,&H80000000,1,0,0,0,100,100,0,0,1,3,1,2,50,50,${Math.round(height * .22)},1\nStyle: Overlay,Arial,${fontSize + 4},&H00FFFFFF,&H0000FFFF,&H00302018,&H90000000,1,0,0,0,100,100,0,0,3,10,0,8,60,60,${Math.round(height * .2)},1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`];
  for (const [kind, events] of [['Caption', plan.captions || []], ['Overlay', plan.overlays || []]]) {
    for (const event of events.slice(0, kind === 'Caption' ? 3000 : 50)) {
      const start = Math.max(0, Number(event.start)), end = Math.min(plan.durationSec, Number(event.end));
      const text = safe(event.text);
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const x = width * (event.position?.x ?? 50) / 100;
      const y = height * (event.position?.y ?? (kind === 'Caption' ? 78 : 20)) / 100;
      const effect = event.motion || (kind === 'Caption' ? 'fade' : 'slide');
      const position = effect === 'slide' ? `\\move(${x},${y + 12},${x},${y},0,180)` : `\\pos(${x},${y})`;
      const motion = `\\an${kind === 'Caption' ? 2 : 8}${position}\\fs${event.fontSize || (kind === 'Caption' ? fontSize : fontSize + 4)}${effect === 'none' ? '' : kind === 'Caption' ? '\\fad(60,60)' : '\\fad(180,180)'}`;
      lines.push(`Dialogue: ${kind === 'Overlay' ? 1 : 0},${stamp(start)},${stamp(end)},${kind},,0,0,0,,{${motion}}${text}`);
    }
  }
  return lines.join('\n');
}
module.exports = { podcastSubtitles };
