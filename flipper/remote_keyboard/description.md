Type on a computer from a phone or laptop. The Flipper plugs into the computer's USB port as a keyboard, and a web page on the phone or laptop sends it key presses over Bluetooth LE.

## Usage

1. Plug the Flipper into the computer and start **Remote Keyboard**.
2. On the phone or laptop, open https://jaansusi.github.io/flipper-bt-keyboard/ and tap **Connect**.
3. On first connection, enter the PIN shown on the Flipper.

The web page needs Web Bluetooth: **Chrome** on Android, **Bluefy** on iPhone or iPad, or **Chrome** or **Edge** on a computer. Safari and Firefox do not support it.

## Features

- **Type text:** a command or text block is sent in one go. A masked password field can append Enter, e.g. for a disk-unlock prompt.
- **Live keyboard:** each key is sent as it is typed, from a phone keyboard or from a laptop keyboard including arrows, F-keys and shortcuts.
- **Special keys:** Esc, Tab, arrows, F1-F12, Ctrl+Alt+Del and more. Modifiers apply to the next key or stay held, e.g. Alt held while Tab switches windows.
- **Pairing with a PIN:** the link is encrypted and only paired devices can type.
- **Pre-boot use:** the Flipper is a boot-protocol keyboard, so BIOS/UEFI setup and boot menus work.

## Menu

OK opens a menu on the Flipper:

- **Forget paired devices:** removes all pairings; devices must pair again with a PIN.
- **Debug logging:** saves connection and error information to the SD card, to find out what went wrong afterwards.
- **Log keystrokes:** shown while debug logging is on; adds the received keys to the log.

Source code and documentation: https://github.com/jaansusi/flipper-bt-keyboard
