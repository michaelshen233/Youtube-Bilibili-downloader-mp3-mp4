# YouTube Downloader Chrome companion

Send the YouTube video in your current tab to the desktop app, choose video quality or MP3 audio, and see your recent downloads.

## Install in Chrome

1. Keep this `chrome-extension` folder in its current location. If you downloaded a ZIP, extract it first.
2. Open **chrome://extensions** in Chrome.
3. Turn on **Developer mode** in the top right.
4. Click **Load unpacked** and select the `chrome-extension` folder containing `manifest.json`.
5. Click Chrome’s puzzle-piece button and pin **YouTube Downloader · Desktop companion**.

Chrome requires this unpacked installation step for a local extension. It cannot be installed by dragging a ZIP onto the toolbar. After updating the files, click the extension’s **Reload** button at chrome://extensions.

## Connect once

1. Launch **YouTube Downloader.exe** on the same computer.
2. In the app’s Chrome extension section, copy the displayed **8-character pairing code**.
3. Click the extension’s toolbar icon, paste the code, and click **Connect**.
4. If the app shows a different local address, paste that address into **App address** before connecting. The default is `http://127.0.0.1:4318`.

Pairing survives reopening Chrome and the desktop app. **Forget pairing** removes the saved connection from this browser. The app’s **Disconnect extensions** control revokes every paired extension; reconnect with a fresh code afterward.

## Download a video

Open a YouTube video, Short, or individual live-video link, then click the extension. Choose **Video** or **Audio**, pick your quality, and click **Send to desktop app**. The desktop app handles the download while you browse. **Open folder** shows saved files; **Open app** opens the app’s local browser interface while it is running.

Playlist pages, channels, and non-YouTube pages cannot be sent. Live broadcasts that are still in progress are handled by the desktop app’s existing download rules. Opening the popup only checks the connection and queue; a download starts only when you click the send button.

If the popup says **App is offline**, launch the desktop app and click **Check connection**. The extension cannot launch the Windows executable directly. If pairing was reset, copy the new code from the app and connect again.

## Privacy and permissions

This extension uses only **activeTab** (the current tab after you click the toolbar icon), **storage** (your connection and download preferences), and permission to contact **127.0.0.1** and **localhost**. It has no content scripts, background downloads, remote services, or YouTube account access. The pairing token is sent only to the configured local app and is bound by the app to this extension’s identity. Video titles and queue details are rendered as plain text.

The app and extension communicate using local HTTP. Keep the pairing code private and use the app’s disconnect control to revoke unwanted pairings. Chrome’s host permission covers local ports so the companion also works when the default port is occupied.

Chrome documentation: [load an unpacked extension](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked), [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [extension permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions).

## Checks

Run the tests from the app folder with the bundled Node runtime:

```powershell
.\.tools\node.exe --test .\chrome-extension\tests\companion.test.mjs
```

For a browser check, load the folder in Chrome, pair with the app, open an individual YouTube video, and verify the format controls, queue status, and folder action. Revoking the pairing in the app should show **Pair again**; closing the app should show **App is offline**.
