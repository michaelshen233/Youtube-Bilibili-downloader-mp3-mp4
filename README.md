# Youtube-Bilibili-downloader-mp3-mp4

A Windows desktop downloader and Chrome companion for saving individual YouTube
videos and Shorts as video or MP3 audio. The application currently accepts YouTube
links; Bilibili support is not implemented.

## Features

- Queue up to 20 video links at a time.
- Choose video quality or save MP3 audio at 192 kbps.
- Follow download progress, cancel jobs, and retry failures.
- Send the current YouTube video from the paired Chrome extension.
- View individual download logs and open saved files in Explorer.

## Run from source

The Git repository contains source code, icons, tests, and third-party notices.
The portable executable, third-party runtimes, downloaded media, and local
connection settings are excluded from Git.

On 64-bit Windows, install Node.js 22 or newer, open PowerShell in this folder,
and start the browser interface:

```powershell
node app/server.js --portable
```

The first run downloads yt-dlp and FFmpeg from their upstream GitHub releases and
verifies their checksums. Keep the terminal open while the app is running. Media
is saved in `downloads/`, and download logs are saved in `logs/`.

### Build the Windows desktop app

The native interface uses Windows Forms and the .NET Framework C# compiler.
After the first source run has created `.tools/`, stop that server with Ctrl+C,
then run:

```powershell
Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination '.tools/node.exe'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:x64 /optimize+ /win32icon:.tools/app-icon.ico '/out:YouTube Downloader.exe' /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll app/NativeWindow.cs
```

Open `YouTube Downloader.exe`. Keep `.tools/` and `app/` beside the executable.
See [the app guide](READ%20ME.txt) for desktop controls, logs, and retries.

### Chrome companion

Follow [the extension setup guide](chrome-extension/README.md). Load the
`chrome-extension` folder through Chrome's **Load unpacked** option, then pair
using the code shown in the desktop app or its browser setup guide. Keep the
app running while using the extension.

The desktop app's **Desktop shortcut** button creates the local Windows shortcut.
The optional extension ZIP is a generated packaging artifact and is not included
in a source checkout; Chrome can load the extension folder directly.

## Tests

Run the backend and extension unit tests with an installed Node.js runtime:

```powershell
node --test app/server.test.js chrome-extension/tests/companion.test.mjs
```

The additional browser smoke tests require Playwright and Google Chrome.

## Credits and attribution

Created and maintained by **Boyang Shen**.

If you reuse or build upon this project, please credit Boyang Shen in your README
and link to [this repository](https://github.com/michaelshen233/Youtube-Bilibili-downloader-mp3-mp4).
This README acknowledgement is requested; it is not an additional licence condition.

The application relies on these upstream projects:

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) and its contributors for downloading media.
- [FFmpeg and FFprobe](https://ffmpeg.org/) and their developers for media processing.
- [yt-dlp/FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) and
  [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) for Windows builds.
- [Node.js](https://nodejs.org/) and its contributors for the JavaScript runtime.
- [Microsoft Playwright](https://github.com/microsoft/playwright) for browser testing.

Keep the [third-party notices](licenses/THIRD-PARTY.txt) and the full licence files
under `licenses/` when applicable. The recorded binary versions describe the local
portable package; source setup downloads upstream releases current at setup time.
Redistributing a portable package requires updating notices for the exact binaries
and satisfying their respective source-distribution obligations.

## Licence

The application's original code is licensed under the [Apache License 2.0](LICENSE).
See [NOTICE](NOTICE) for attribution. Third-party tools and dependencies retain
their own licences; the project's Apache licence does not replace those terms.
