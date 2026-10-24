# Flipper Remote Keyboard

Type on a server that has no keyboard attached, from your phone.

Plug a [Flipper Zero](https://flipperzero.one) into the server's USB port and it
becomes the server's keyboard. Open a web page on your phone, connect to the
Flipper over Bluetooth, and whatever you type is typed on the server: a console
login, a boot menu choice, a disk-encryption passphrase, a BIOS setting. You
stand at the server and watch its screen; your phone is the keyboard.

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/web-type-text-dark.png">
    <img src="docs/images/web-type-text-light.png" width="270" alt="Web page on a phone, Type text tab: a text box with a command, a Send button, a password field, and collapsed special key sections">
  </picture>
  &nbsp;&nbsp;
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/web-live-keys-dark.png">
    <img src="docs/images/web-live-keys-light.png" width="270" alt="Web page on a phone, Live keyboard tab: a typing field, and special keys with Alt held, Esc, Tab, Enter and arrow buttons">
  </picture>
</p>

## How it works

```mermaid
flowchart LR
    phone["Phone or laptop<br/>web page in the browser"]
    flipper["Flipper Zero<br/>Remote Keyboard app"]
    server["Server<br/>no keyboard attached"]
    phone -- "Bluetooth LE<br/>key presses" --> flipper
    flipper -- "USB<br/>acts as a keyboard" --> server
```

1. The web page turns what you type into key presses and sends them to the
   Flipper over Bluetooth LE.
2. The Remote Keyboard app on the Flipper replays them on its USB port, where
   the server sees an ordinary USB keyboard. No software or drivers on the server.
3. Nothing comes back: you see the result on the server's own screen.

## Features

- **Type text:** type or paste a command and send it in one go. A separate,
  masked password field can press Enter for you, e.g. at a disk-unlock prompt.
- **Live keyboard:** every key goes through as you type, with your phone's
  keyboard, or a laptop's own keyboard including arrows, F-keys and shortcuts.
- **Special keys:** Esc, Tab, arrows, F1–F12, Ctrl+Alt+Del and more. Modifiers
  can apply to the next key or stay held, e.g. hold Alt and tap Tab to switch
  windows.
- **Secure pairing:** the Flipper shows a PIN the first time a device connects,
  and the link is encrypted. Only paired devices can type.
- **No install:** just a web page. Add it to your home screen and it works
  offline after the first visit.
- **Before the OS starts:** the Flipper presents a standard boot-protocol
  keyboard, meant for BIOS/UEFI setup and boot menus too.

## Install and use

You need a Flipper Zero on the latest official firmware, and one of these
browsers: **Chrome** on Android, **[Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055)**
on iPhone or iPad, or **Chrome / Edge** on a computer. Safari and Firefox have no
Web Bluetooth.

1. Download `remote_keyboard.fap` from
   [Releases](https://github.com/jaansusi/flipper-bt-keyboard/releases) and copy it
   to the Flipper's SD card at `apps/USB/` with qFlipper.
2. Plug the Flipper into the server and open **Apps → USB → Remote Keyboard**.
3. On your phone, open **https://jaansusi.github.io/flipper-bt-keyboard/**, tap
   **Connect** and choose your Flipper. The first time, enter the PIN shown on
   the Flipper.

On the Flipper, **OK** opens a menu to forget all paired devices or turn on
debug mode. **Back** exits.

## Documentation

How it works in detail, how to build it, test it and release it:
[docs/](docs/README.md).

## License

[MIT](LICENSE)
