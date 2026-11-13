# Retro Launcher Web

The Retro Game Suite 3.11 Program Manager desktop, ported to static web hosting. It keeps the original desktop, menus, group windows and built-in accessories. The browser edition runs compatible games inside a Program Manager window.

- [Open the hosted Program Manager](https://markboog.github.io/retro-launcher-web/).
- **Load Game Library** opens whenever the page starts without a loaded library. Choose **Load Family Library** and sign in with the Google account invited to the ZIP. The launcher opens the family ZIP directly if it already has access. If Google asks for approval, the picker displays only that ZIP. The launcher loads the catalog and reads each game when you open it.
- To use a local copy, choose **Download Family ZIP**, then **Open Library ZIP** and select the saved archive. You can also choose a ZIP from Google Drive for desktop or import an extracted game folder. **Maybe later** dismisses the prompt for the current page. Reopen it from **File → Load Game Library**.
- Open **Game Boy** and double-click **Game Boy Snake** to try the included demo. Click the game screen, press Enter to start, and use the arrow keys to steer. The [demo source and license](public/demo/README.md) are included.
- Use **File → Open Game File** to play one local game. For a ZIP or BIN containing one game, choose its system.
- Open **DOS Classics** and double-click a game from the family library to run it in the Program Manager window. The browser loads DOSBox automatically. Click the game screen for keyboard input. Some original DOS titles take a few seconds to reach their menus. Use the Windows edition for Windows 3.1 Win16, arcade and disc images.

Files you choose are read in the browser. The published site contains the licensed demo and no personal game library. The browser loads the [js-dos runtime](public/vendor/js-dos/LICENSE-NOTICE.md) for DOS and EmulatorJS for Game Boy, Game Boy Color, Super Nintendo and Sega Genesis / Mega Drive. Games start muted, and you can raise the volume in the player's controls. Imported games stay available for the tab session. DOS in-game saves last until you close the player. Favorites are stored in the browser.

## Run locally

Use Node.js 22.13 or newer.

    npm ci
    npm test
    npm run dev

The GitHub Pages workflow tests and builds the static site with npm run build, then deploys dist on pushes to main.

## Connect Google Drive

The hosted launcher can point to a default family ZIP. A link with `#library=DRIVE_FILE_ID` can point to a different ZIP. In both cases Drive checks the signed-in account's permission to open the file.

The family flow always targets its linked or configured file, even if a different library was opened before. If the launcher needs access to the file, Google Picker opens during the same connection and shows that file to accounts that can access it. **Switch Google Account** retries the same ZIP with a different account. Deployments without a default ZIP or a family link can still browse for a ZIP. Each new session needs a current Google access token.

Enable Google Drive API and Google Picker API in a Google Cloud project. Configure a web OAuth client for `https://markboog.github.io` and the `drive.file` scope. Restrict the Picker key to the site's origin and `https://docs.google.com/*` and to the relevant APIs. See the [Google Picker setup guide](https://developers.google.com/workspace/drive/picker/guides/web-picker#setup).

Set the GitHub Actions repository variables `VITE_DRIVE_CLIENT_ID` and `VITE_DRIVE_PROJECT_NUMBER`, plus the repository secret `VITE_DRIVE_PICKER_KEY`, then rerun the Pages build. Optionally set `VITE_DEFAULT_LIBRARY_FILE_ID` to offer a specific ZIP on the main URL. The default ID is visible in the browser build, and Drive permissions govern who can read the ZIP. Keep OAuth client secrets and access tokens out of repository configuration and build output. Local ZIP and folder imports work without Drive configuration.
