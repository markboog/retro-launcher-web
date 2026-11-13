# js-dos runtime notice

The browser DOS player loads the upstream js-dos **8.4.0** runtime and its
version-matched emulator files from pinned npm package URLs served by jsDelivr:
`https://cdn.jsdelivr.net/npm/js-dos@8.4.0/dist/` and
`https://cdn.jsdelivr.net/npm/emulators@8.4.0/dist/`. This project does not
bundle or modify those runtime binaries.

js-dos and its emulator backends are distributed under **GNU General Public
License, version 2**. The corresponding source is available from the upstream
repositories:

- js-dos: <https://github.com/caiiiycuk/js-dos/tree/8.xx>
- emulators: <https://github.com/caiiiycuk/emulators>

The DOSBox player does not upload selected game files. js-dos local filesystem
change persistence, autosave, cloud UI, and IPX networking are disabled by the
integration; the isolated player frame only permits requests to the pinned
versioned runtime packages on jsDelivr.
