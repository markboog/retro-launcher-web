# Retro Launcher Web

The Retro Game Suite 3.11 Program Manager desktop, ported to static web hosting. It keeps the original desktop, menus, group windows and built-in accessories. The browser edition runs compatible games inside a Program Manager window.

- [Open the hosted Program Manager](https://markboog.github.io/retro-launcher-web/).
- **Load Game Library** opens on the first visit in a tab. Choose a game folder or select **Maybe later** to use the desktop. Reopen it anytime from **File → Load Game Library**.
- Open **Game Boy** and double-click **Game Boy Snake** to try the included demo. Click the game screen, press Enter to start, and use the arrow keys to steer. The [demo source and license](public/demo/README.md) are included.
- Use **File → Open Game File** to play one local game. For a ZIP or BIN, choose its system. Use **File → Import Game Folder** to browse supported games from the extracted Windows family ZIP. Select its games folder.
- The browser edition supports compatible Game Boy, Game Boy Color, Super Nintendo and Sega Genesis / Mega Drive ROMs. Use the Windows edition for DOS, Windows 3.1 Win16 and arcade emulators.

Files you choose are read in the browser. The published site contains the licensed demo and no personal game library. The emulator engine is loaded from the versioned EmulatorJS CDN. Games start muted, and you can raise the volume in the player's controls. Imported games are available for the tab session and favorites are stored by this site in the browser.

## Run locally

Use Node.js 22.13 or newer.

    npm ci
    npm test
    npm run dev

The GitHub Pages workflow tests and builds the static site with npm run build, then deploys dist on pushes to main.

## Connect Google Drive

When Drive is configured, the startup prompt includes **Connect Google Drive**. Sign in with the Google account invited to the family ZIP and select the archive once. The launcher remembers the selected file in that browser and reads only the index and the requested games. Each new session needs a current Google access token.

Enable Google Drive API and Google Picker API in a Google Cloud project. Configure a web OAuth client for `https://markboog.github.io` and the `drive.file` scope. Restrict the Picker key to the site's origin and `https://docs.google.com/*` and to the relevant APIs. See the [Google Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker#setup).

Set the GitHub Actions repository variables `VITE_DRIVE_CLIENT_ID` and `VITE_DRIVE_PROJECT_NUMBER`, plus the repository secret `VITE_DRIVE_PICKER_KEY`, then rerun the Pages build. These three identifiers are delivered to the browser. Keep OAuth client secrets, tokens and private Drive file identifiers out of repository configuration and build output. The launcher offers local folder import when the three Drive settings are absent.
