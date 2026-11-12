# Retro Launcher Web

The Retro Game Suite 3.11 Program Manager desktop, ported to static web hosting. It keeps the original desktop, menus, group windows and built-in accessories. The browser edition runs compatible games inside a Program Manager window.

- [Open the hosted Program Manager](https://markboog.github.io/retro-launcher-web/).
- **Load Game Library** opens whenever the page starts without a loaded library. With the family launch link, choose **Download family ZIP**, sign in to Google Drive if prompted, and return to the launcher when the download finishes. Choose **Open library ZIP** and select the archive from Downloads or wherever your browser saved it. You can also select a ZIP from Google Drive for desktop or choose an extracted game folder. **Maybe later** dismisses the prompt for the current page. Reopen it from **File → Load Game Library**.
- Open **Game Boy** and double-click **Game Boy Snake** to try the included demo. Click the game screen, press Enter to start, and use the arrow keys to steer. The [demo source and license](public/demo/README.md) are included.
- Use **File → Open Game File** to play one local game. For a ZIP or BIN containing one game, choose its system.
- The browser edition supports compatible Game Boy, Game Boy Color, Super Nintendo and Sega Genesis / Mega Drive ROMs. Use the Windows edition for DOS, Windows 3.1 Win16 and arcade emulators.

Files you choose are read in the browser. The published site contains the licensed demo and no personal game library. The emulator engine is loaded from the versioned EmulatorJS CDN. Games start muted, and you can raise the volume in the player's controls. Imported games are available for the tab session and favorites are stored by this site in the browser.

## Run locally

Use Node.js 22.13 or newer.

    npm ci
    npm test
    npm run dev

The GitHub Pages workflow tests and builds the static site with npm run build, then deploys dist on pushes to main.

## Connect Google Drive

To create a family launch link, append `#library=DRIVE_FILE_ID` to the hosted launcher URL, substituting the file ID from the Drive sharing link. Send the launch link to the people you give Drive access. Google handles sign-in and download. The file ID stays in the launch link instead of the published app.

When Drive is configured, the startup prompt includes **Connect Google Drive**. Sign in with the Google account invited to the family ZIP and select the archive once. The launcher remembers the selected file in that browser and reads only the index and the requested games. Each new session needs a current Google access token. A restricted Drive sharing link opens in Drive and cannot be used in place of this connection.

Enable Google Drive API and Google Picker API in a Google Cloud project. Configure a web OAuth client for `https://markboog.github.io` and the `drive.file` scope. Restrict the Picker key to the site's origin and `https://docs.google.com/*` and to the relevant APIs. See the [Google Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker#setup).

Set the GitHub Actions repository variables `VITE_DRIVE_CLIENT_ID` and `VITE_DRIVE_PROJECT_NUMBER`, plus the repository secret `VITE_DRIVE_PICKER_KEY`, then rerun the Pages build. These three identifiers are delivered to the browser. Keep OAuth client secrets, tokens and private Drive file identifiers out of repository configuration and build output. Local ZIP and folder imports work without Drive configuration.
