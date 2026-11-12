# Retro Launcher Web

The Retro Game Suite 3.11 Program Manager desktop, ported to static web hosting. It keeps the original desktop, menus, group windows and built-in accessories. The browser edition runs compatible games inside a Program Manager window.

- [Open the hosted Program Manager](https://markboog.github.io/retro-launcher-web/).
- Open **Game Boy** and double-click **Game Boy Snake** to try the included demo. Click the game screen, press Enter to start, and use the arrow keys to steer. The [demo source and license](public/demo/README.md) are included.
- Use **File → Open Game File** to play one local game. For a ZIP or BIN, choose its system. Use **File → Import Game Folder** to browse supported games from the extracted Windows family ZIP. Select its games folder.
- The browser edition supports compatible Game Boy, Game Boy Color, Super Nintendo and Sega Genesis / Mega Drive ROMs. Use the Windows edition for DOS, Windows 3.1 Win16 and arcade emulators.

Files you choose are read in the browser. The published site contains the licensed demo and no personal game library. The emulator engine is loaded from the versioned EmulatorJS CDN. Games start muted, and you can raise the volume in the player's controls. Imported games are available for the tab session and favorites are stored by this site in the browser.

## Run locally

Use Node.js 22.12 or newer.

    npm ci
    npm test
    npm run dev

The GitHub Pages workflow tests and builds the static site with npm run build, then deploys dist on pushes to main.
