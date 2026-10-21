---
title: Mobile monitor
---

# Mobile monitor

The mobile monitor is a phone-sized view of the board. Use it to check progress and to answer an agent's question when you are away from your desk. This page explains what the monitor shows, how to connect it from your phone with ngrok, and how to check that it works.

## What the monitor shows

The monitor groups tasks into Todo, Doing, and Done. AI-owned tasks show their agent state inline; Pending questions in Todo or Doing show an answer form on the task. Tapping a task opens a bottom drawer with **Body**, **Conditions**, **History**, and **Epic** tabs. The drawer slides up from the bottom, follows a downward drag of its top handle, and closes when dismissed; each tab's content scrolls independently. The Conditions tab shows only the task's own conditions; epic reference conditions remain in the epic details. The Epic tab shows the epic details without repeating the label or title already shown in the drawer and body. The monitor can answer a pending question, but its only write operation is that answer.

![Mobile monitor with a task drawer open on the Body tab, showing the four tabs](../../images/mobile.png){.screenshot--narrow}

Horizontal swipes move the tab content and underline together. Gestures inside the tab content stay within that area; drag the top handle to dismiss the drawer. Each project's complete epic list is loaded when the monitor initializes and retained for the page session. Switching tabs performs no epic request. Reload the page to refresh the epic lists, or use the retry button after a failed initial request.

The monitor HTML and API responses are never cached. The browser keeps the monitor's scripts and styles, so later visits download only the page and the data. The monitor has no offline snapshot cache or service worker.

After you install a new version and restart `agboard serve`, an open monitor reloads itself to show the new UI. If you are writing an answer, it waits until you send or clear it. When disconnected, the page reports the connection state.

## Before you start

You need:

- An ngrok account and its authtoken. Copy the token from your ngrok dashboard.
- The Google account you will sign in with on the phone. Agent Board connects only the accounts you list.

Agent Board uses ngrok to open a public HTTPS address that leads to the monitor only. The full board stays on `127.0.0.1`. Never expose the board to the public Internet and never use router port forwarding. ngrok ends the HTTPS connection, so ngrok can process the traffic; the connection is not end-to-end encrypted between your PC and your phone.

## Connect from the PC

1. Open the board, then open **Settings**. In **Mobile connection**, choose **Set up**.
2. Enter your ngrok authtoken in **ngrok auth token**.
3. Decide whether to keep the token (see [Where the token is kept](#where-the-token-is-kept)).
4. In **Google email allowed to connect**, enter the Google account you will use on the phone. To allow more than one account, separate the addresses with commas, semicolons, or spaces. At least one is required, and nobody else can connect.
5. Leave **ngrok domain (optional)** empty to let ngrok choose the address, or enter a reserved ngrok host name such as `your-name.ngrok.app` to keep the same address.
6. Choose **Save and connect**.

While it connects, the dialog shows **Connecting to ngrok…**. When it is ready, the dialog shows **Connected**, the **URL for your phone**, and a QR code. **Copy URL** copies the address. The QR code only carries the address: signing in with Google is still required, and the PC does not ask you to approve a device.

If ngrok cannot be reached, the dialog says the settings were saved but ngrok could not be reached. Check the token and the internet connection, then choose **Save and try again**. The board on the PC keeps working.

The Google sign-in uses ngrok's managed Google app by default. Your own Google app can be selected only from the command line (see [Start it from the command line](#start-it-from-the-command-line)).

## Where the token is kept

- A token you type is used only while Agent Board is running and is not saved.
- To keep it, select **Save the token in this PC's keychain** before you connect. The token is stored in the operating system's keychain: Keychain on macOS, Credential Manager on Windows, and the Secret Service on Linux. It is never written to the data folder.
- If the `NGROK_AUTHTOKEN` environment variable is set, it takes priority over a saved token. The dialog then says it is using the environment variable, and you can leave the token field empty.
- A saved token is shown as saved in the keychain. Choose **Delete the saved token** to remove it.
- If the PC has no usable keychain, the dialog says **This PC cannot save the token. Enter it each time.** and the save option is unavailable. Enter the token each time you connect.

The allowed Google accounts and the domain are stored in Agent Board's internal area. You do not edit a file for them.

## Open it on the phone

1. On the phone, open the URL or scan the QR code.
2. Sign in with Google using an allowed account. The account must be signed in on the phone you connect with.
3. The monitor opens. The connection lasts up to 12 hours; after that, or when the sign-in expires, the page shows **Reconnect with Google**. Choose it and sign in again.

A Google account that is not on the list is refused by ngrok before the monitor loads. Knowing the address is not enough to read the board. If the page says the connection is stopped or no longer allowed, check the PC.

## Stop and connect again

Choose **Stop** in the connected dialog to close the connection. The phone can no longer read the board or send answers, and the connection stays off the next time Agent Board starts. To connect again, open **Mobile connection**, check the fields, and choose **Save and connect**.

If the connection drops, for example because the PC slept or the network changed, stop it and connect again. Changing the allowed accounts or the domain with **Change connection settings** and **Save and connect** also replaces the connection, so the phone has to sign in again.

When the connection was left on, it starts again the next time Agent Board starts, as long as a token is available from the environment or the keychain. Without one, the dialog asks for the token.

## Check that ngrok keeps no traffic content

ngrok's Traffic Inspector can keep request details if **Full Capture** is turned on for your account. Agent Board cannot turn it off for you. In the ngrok dashboard, open **Settings** → **Observability** and confirm that Full Capture is disabled. Do this before you use the monitor.

## Start it from the command line

To start the connection with the server, set the token in the environment and add the allowed accounts:

```sh
export NGROK_AUTHTOKEN=<your authtoken>
agboard serve --monitor ngrok --ngrok-allow-email you@example.com
```

Repeat `--ngrok-allow-email` for each account. Add `--ngrok-domain your-name.ngrok.app` for a reserved domain. `--ngrok-oauth-app custom` uses your own Google app and needs `AGBOARD_GOOGLE_CLIENT_ID` and `AGBOARD_GOOGLE_CLIENT_SECRET` in the environment; the default is `managed`. The command prints the phone address with the local address, or in the `monitor` field with `--json`. If the connection cannot start, `serve` stops with exit code 1. The other options are in the [CLI guide](../automation/cli).

When the computer sleeps or the server stops, the monitor is unavailable until the server and the connection run again.

## Check on a phone

Responsive browser tests cover narrow viewports; the software keyboard needs a real-device check. Open the monitor in the phone's browser and find a Todo or Doing task with a Pending question. Confirm that the keyboard leaves the answer field and Send button reachable, then submit an answer. Also check scrolling in long Body, Conditions, and Epic tabs, horizontal tab swipes, and downward dismissal using the handle. Browser emulation alone does not verify Safari's keyboard behavior.

## Next

- [Decisions](../use/decisions): answer a question from your phone.
- [Troubleshooting](./troubleshooting): the page does not load or does not update.
