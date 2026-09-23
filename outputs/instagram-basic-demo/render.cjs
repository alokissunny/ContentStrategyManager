const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const ffmpeg = path.join(root, 'backend/node_modules/ffmpeg-static/ffmpeg');
const source = '/Users/alok/Desktop/Screen Recording 2026-09-22 at 11.30.57 PM.mov';
const font = '/System/Library/Fonts/Supplemental/Arial.ttf';
const filters = ['fps=30', 'scale=1728:1118', 'pad=1728:1250:0:0:color=0x111827'];
function label(text, x, y, size, start, end, color='white') {
  filters.push(`drawtext=fontfile=${font}:text='${text}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}:enable='between(t,${start},${end})'`);
}
label('INSTAGRAM ACCOUNT METADATA', 40, 1137, 21, 0, 70, '0xa3e635');
const steps = [
  [0, 15, '1. Sign in to Bauhly to manage your Instagram connection.'],
  [15, 27, '2. Open Accounts & connections and connect Instagram.'],
  [27, 37, '3. Sign in with the Instagram account you want to connect.'],
  [37, 44, '4. Review the Instagram consent screen and allow account access.'],
  [44, 55.8, '5. Return to Bauhly. The authorized Instagram account is now linked.'],
  [55.8, 60, 'Account identity shown here - Instagram username (@bauhly).'],
  [60, 70, 'Profile metadata shown here - followers, following and total posts.'],
];
for (const [s,e,text] of steps) label(text, 40, 1174, 29, s, e);
label('Permission used to read account metadata - instagram_business_basic', 40, 1220, 18, 0, 70, '0xcbd5e1');
filters.push("drawbox=x=662:y=608:w=235:h=55:color=0x65a30d:t=4:enable='between(t,55.8,60)'");
filters.push("drawbox=x=662:y=691:w=231:h=31:color=0x65a30d:t=4:enable='between(t,60,70)'");
// An unobtrusive key in the blank right margin maps displayed counts to API fields.
filters.push("drawbox=x=1340:y=602:w=350:h=160:color=0x111827@0.96:t=fill:enable='between(t,60,70)'");
label('PROFILE FIELDS', 1358, 619, 20, 60, 70, '0xa3e635');
label('followers_count  -  2', 1358, 656, 22, 60, 70);
label('follows_count     -  0', 1358, 689, 22, 60, 70);
label('media_count       -  0', 1358, 722, 22, 60, 70);
filters.push('tpad=stop_mode=clone:stop_duration=3');
const result = spawnSync(ffmpeg, ['-hide_banner','-y','-i',source,'-t','67.5','-vf',`trim=end=64.5,setpts=PTS-STARTPTS,${filters.join(',')}`,'-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',path.join(__dirname,'instagram-business-basic-annotated.mp4')], { stdio: 'inherit' });
process.exit(result.status || 0);
