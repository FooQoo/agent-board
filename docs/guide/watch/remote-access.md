---
title: Remote access
---

# Remote access

Remote access opens the board from another device when you are away from your desk, most often a phone. Use it to check progress and to answer an agent's question. This page explains what the phone screen shows, how to connect it with ngrok, and how to check that it works.

## What the monitor shows

The monitor shows one project at a time. The address names it (`?project=`), and the project switcher in the header lists every project, as on the PC. The screen shows one lane at a time, Todo, Doing, or Done, and you move between them as described in [Switch lanes](#switch-lanes). AI-owned tasks show their agent state inline; Pending questions in Todo or Doing show an **Answer the question** button on the task, which opens an answer sheet from the bottom.

The **Messages** band sits above the lane tabs. It shows how many questions wait on you and how many of your requests no agent has picked up. **Questions & requests** slides up a sheet with the open messages in two tabs; pick a question to answer it there, with **Back to list** (or **Later**) and **Send answer** pinned at the bottom (see [Decisions](../delegate/decisions#answer-on-your-phone)).

AI drafts show as ordinary cards in the Todo lane with a **Draft** badge, and the Todo tab counts them. The agent starts them itself once its questions are answered (see [Drafts](./board#drafts)).

![Remote access showing the Doing lane with its tab bar, the Messages band, and three tasks](../../images/mobile-cards.png){.screenshot--narrow}

### Switch lanes

The tabs under the header are named **Todo**, **Doing**, and **Done**, and each shows how many tasks its lane holds. Tap a tab to show that lane. You can also swipe sideways anywhere on the lane, including from a task you have not chosen, to move to the lane beside it. A swipe past Todo or Done stays where it is. Each lane scrolls on its own, and a vertical scroll never changes the lane.

### Move or archive a task

Moving and archiving start from a task you have chosen, so a stray swipe does not change anything.

1. Press and hold a task until it shows an outline. That chooses it.
2. Swipe the chosen task sideways. A swipe to the left shows a button for the next lane and the red **Archive** button with a trash can icon. A swipe to the right shows a button for the previous lane. The same press that chose the task can continue into the swipe. Each lane button shows the icon of its lane; a screen reader reads it as, for example, **Move #3 to Doing**.
3. Tap a button. A lane button opens **Move task**, where you can add a reason and choose **Move**. The archive button opens **Archive task**, where you choose **Archive**. Nothing changes until you confirm, and **Cancel** leaves the task where it was.

![Remote access with a chosen task slid open, showing its move and archive buttons](../../images/mobile-swipe.png){.screenshot--narrow}

Swipe the task back, or tap anywhere outside it, to close the buttons without a change. A swipe never deletes a task. Archived tasks can be restored, and permanent deletion is only available from the archive screen of a wider window, as on the PC.

### Archive all done tasks

The Done lane has an **Archive all** button below its cards. It opens **Archive completed tasks**, which lists every task that would be archived; choose **Archive** with the count to confirm. The button is disabled while the lane is empty.

### Read a task

Tapping a task opens a bottom drawer with **Body**, **Conditions**, **Results**, **History**, and **Epic** tabs. The drawer slides up from the bottom, follows a downward drag of its top area (the handle and header, not the close button), and closes when dismissed; each tab's content scrolls independently. The Conditions tab shows only the task's own conditions; epic reference conditions remain in the epic details. The Epic tab shows the epic details without repeating the label or title already shown in the drawer and body. The monitor can answer a pending question, check and uncheck a task's acceptance conditions in the Conditions tab (they work as on the board; see [The board](./board#read-a-task)), and change the language and color theme. Through the passcode you can also do what the PC board does, as described in [Use the whole board through the address](#use-the-whole-board-through-the-address). The connection settings stay on the PC.

![Remote access with a task drawer open on the Conditions tab, showing the tabs](../../images/mobile.png){.screenshot--narrow}

The **Results** tab lists what an agent delivered for you to look at, newest first, with each summary, image, and link text. See [Read a result](./board#read-a-result).

### Open a result from a link {#open-a-result-from-a-link}

A link to one result has the form `https://<host>/?project=<ProjectId>&task=<id>&result=<version>`, where `<host>` is the address of the connection. Opening it on the phone asks for the passcode first, if you have no live session, and keeps the whole address while it does. After the passcode, the board opens that project, then that task's drawer on the **Results** tab, scrolled to the result and highlighted. It does not matter which project was on the screen before. Closing the drawer takes the task and result out of the address, so the board stays where you left it. An address with a task or version that is not a positive number opens the plain board.

Horizontal swipes move the tab content and underline together. Gestures inside the tab content stay within that area; drag the handle or header to dismiss the drawer. Opening a task reads its text, conditions, history, and epic once, so switching tabs does not wait for a read. If a read fails, use the retry button in that tab.

The monitor updates itself when the PC saves a change. To read the latest data at once, choose the **Refresh** button in the header. The page keeps the last data it has while it reads again.

The page and the data responses are never cached. The browser keeps the scripts and styles, so later visits download only the page and the data. The monitor has no offline snapshot cache or service worker.

After you install a new version and restart `agboard serve`, an open monitor reloads itself to show the new UI. If you have answers that are not sent or a task drawer open, it waits until you send or clear the answers, or close the drawer. When disconnected, the page reports the connection state.

## Before you start

You need an ngrok account and its authtoken. The **Remote connection** dialog has a button that opens the ngrok page where you copy the token. Agent Board opens the address without any of ngrok's Traffic Policy features, including its Google sign-in (OAuth), which a free ngrok account cannot use. A free account can therefore run the monitor; the other limits and terms of your ngrok plan still apply.

Agent Board uses ngrok to open a public HTTPS address that leads to the board, behind the passcode. The PC's own address of the board stays on `127.0.0.1`. Never expose the board to the public Internet and never use router port forwarding. ngrok ends the HTTPS connection, so ngrok can process the traffic; the connection is not end-to-end encrypted between your PC and your phone.

## How the passcode protects the monitor

The monitor is guarded by a 4-digit passcode. Agent Board does not use Google authentication or ngrok's sign-in, and it keeps no list of allowed accounts.

- Each time the connection starts, Agent Board makes a new passcode from the operating system's random source, from `0000` to `9999`. It is kept in memory only: it is not saved to a file, logged, or put in the monitor page.
- You see it on the PC only: in the **Remote connection** dialog, in step 2 **Enter the passcode**, and on the startup line of `agboard serve --monitor ngrok`.
- The phone opens the address, asks for the passcode, and shows nothing of the board until the passcode is right. The connection then lasts up to 12 hours, after which the phone asks for the passcode again.
- After 5 wrong passcodes in a row, the monitor stops accepting any passcode, even the right one. Stop the connection and connect again (or restart `serve`) to get a new passcode and a fresh count.

Whoever enters the passcode can use the whole board for up to 12 hours, as on the PC: read every project, and add, edit, move, archive, and delete tasks and epics. Only the connection settings stay on the PC. Giving someone the passcode gives them that access.

A 4-digit passcode has only 10,000 possibilities, so it is weaker than signing in with an account. The 5-attempt limit, the random address that ngrok chooses, and a new passcode at every start make guessing hard, but they are not a substitute for keeping the address private. Treat the address and the passcode like a password pair:

- Do not share the address or the QR code in public places.
- Stop the connection when you are not using it.
- Without a fixed domain, the address is one that ngrok chooses at random. It is harder to find, though it is not a secret you can rely on. With a fixed domain (see below) the address stays the same, so anyone who has seen it once can find it again; the passcode, which changes at every start, is what protects the board.

Because ngrok adds nothing for Agent Board to check, the monitor checks two things itself: the request names exactly the public address, and the passcode. ngrok ends the HTTPS connection and can see the traffic, and anyone who manages your ngrok account can change how the address is served. The passcode does not protect against them.

A program that is already running on your PC can send requests straight to the monitor's local port without going through ngrok. It still needs the passcode to read anything, but it can use up the 5 tries, which closes the monitor to the phone until you stop and connect again. Agent Board trusts the person who uses the PC, so it adds no further protection against this. Run the connection only on a PC you trust.

## Connect from the PC

1. Open the board, then open **Settings**. In **Remote connection**, choose **Connection settings**. The settings dialog closes and the **Remote connection** dialog opens with **Not connected**.
2. In step 1, **Get a token**, choose **Open the token page**. Sign in to ngrok and copy the authtoken.
3. In step 2, **Paste and connect**, paste the token into **ngrok auth token**.
4. Decide whether to keep the token with **Save the token on this PC** (see [Where the token is kept](#where-the-token-is-kept)).
5. Choose **Save and connect**.

While it connects, the dialog shows **Connecting to ngrok…** in place of the two steps. When it is ready, the dialog shows **Accepting connections**. Step 1, **Scan the QR code**, has the QR code and **Copy URL**, which copies the address. The address includes the project selected on the PC. To monitor another project, select it on the PC, then scan the new QR code or copy its URL again. Step 2, **Enter the passcode**, shows the 4-digit passcode. The QR code only carries the address: the phone still has to enter the passcode, and the PC does not ask you to approve a device.

The passcode is shown only while the connection is running. It is new every time the connection starts, so a stopped or failed connection has none.

To give someone the address and passcode while the connection is up, run `agboard --project "<name>" remote`; it prints both on this PC only. See [Give the phone address and passcode](../reference/cli#give-the-phone-address-and-passcode). You can also ask your agent for the remote access URL; the plugin's `remote` skill (`/agent-board:remote` in Claude Code) runs the same command and replies with both, and it never starts the connection. Sharing the passcode in a chat gives everyone who reads that chat access to the board until you stop the connection.

If ngrok cannot be reached, the dialog says so and gives the reason. Check the token and the internet connection, then choose **Save and connect** again. The board on the PC keeps working.

## Where the token is kept

- A token you type is used only while Agent Board is running and is not saved.
- To keep it, select **Save the token on this PC** before you connect. The token is stored in this PC's secure storage, the one your operating system provides. It is never written to the data folder.
- If the `NGROK_AUTHTOKEN` environment variable is set, it takes priority over a saved token. The dialog then says it is using the environment variable, and you can leave the token field empty.
- A saved token is shown as saved in this PC's secure storage. Choose **Delete the saved token** to remove it.
- After Agent Board is updated or reinstalled, the operating system may ask whether Agent Board may use the saved token. The board keeps working while it asks. Once you answer, the dialog shows the saved token.
- If the PC has no usable secure storage, the dialog says **This PC cannot save the token. Enter it each time.** and the save option is unavailable. Enter the token each time you connect.

Whether the connection stays on is stored in Agent Board's internal area. You do not edit a file for it. The passcode is not stored anywhere.

## Open it on the phone

1. On the phone, open the URL or scan the QR code.
2. The page shows **Enter the passcode**. Type the 4-digit passcode shown on the PC and choose **Connect**.
3. The monitor opens, and this phone is now registered. The passcode is needed only this first time: when the 12-hour session ends, after you pause and resume the connection, or after the PC restarts, the phone opens the board again by itself, as long as it reaches the same address. Registration belongs to the address: without an ngrok domain (see below), ngrok chooses a new address at every start, and a phone registered at the old address is asked for the passcode again. If the PC could not save the registration, the phone gets its session but is asked for the passcode next time. A phone that was never registered, or that you removed, is asked for the passcode.

An address without a project opens the board, and you choose the project with the project switcher in the header. Links that ended in `/monitor/` in earlier versions are not served any more: they show a not-found answer. On the PC, open the remote connection settings and scan the current QR code again.

## Use the whole board through the address

The address from the QR code, for example `https://….ngrok.app/?project=…`, opens the board itself: the same board as on the PC, with the screen chosen by the window width (below 768px you get the monitor described above). It asks for the same 4-digit passcode, shows nothing of the board until the passcode is right, and then lets you do what you can do on the PC board, such as editing, moving, and deleting tasks, answering questions, and reading the project documents. The passcode lasts up to 12 hours and has the same limit of 5 wrong tries.

Two things stay on the PC even then: the **Remote connection** settings, and opening a project document in the PC's own application. A page opened through the address does not show **Remote connection** in **Settings**, even on a tablet wide enough for the PC layout. Anyone who has the address and the passcode can change your tasks, so keep both private.

The monitor opens in the language and color theme saved on the PC. If you change them on the phone, from the settings in the monitor header, the new choice is saved on the PC too, so the board and every other browser or phone show it. A change made on the PC appears on an open monitor at once.

On ngrok's free plan, the first visit from a phone shows ngrok's warning page. Choose **Visit Site**, and the monitor opens. ngrok shows the warning to each visitor only once.

Knowing the address is not enough to read the board. A wrong passcode is refused without saying how many tries are left. After 5 wrong passcodes in a row the page says **Too many wrong passcodes** and takes no more; stop the connection on the PC and connect again to get a new passcode. If the page says the connection is stopped, check the PC.

## Pause and resume

Choose **Pause connection** in the dialog to stop public access. The dialog shows **Paused**, and the saved token and the registered phones stay on this PC. No phone can read the board or send answers while it is paused, registered or not, and the connection stays off the next time Agent Board starts. To resume with the saved token, choose **Resume**: registered phones come back without the passcode if the address is the same as when they registered (always with an ngrok domain; without one, ngrok may choose a new address), and a new passcode is made for phones that are not registered yet. To use another token, choose **Change settings**, paste the token, and choose **Save and connect**.

## Registered phones

When a phone has entered the passcode, the dialog shows **Registered phones (n)** next to the status. Choose it to see each phone by a short name such as **iPhone / Safari**, when it was registered, and when it was last used. It works while the connection is paused too.

Choose **Remove** to unregister a phone. It is signed out at once, even in the middle of a session, and has to enter the passcode again. Remove a phone you no longer use, and remove a phone that is lost or stolen right away: a registered phone can open the board without the passcode until you do. A phone is registered by its browser, so clearing the browser's data, or opening the address in another browser, registers it again with the passcode. If you change the ngrok domain, phones registered for the old address are asked for the passcode at the new one.

If the connection drops, for example because the PC slept or the network changed, pause it and resume. To use another token while connected, choose **Reset token**, which shows the setup again, enter the new token, and choose **Save and connect**. This replaces the connection, so the phone has to enter the new passcode. Closing the dialog instead leaves the connection as it was.

When the connection was left on, it starts again the next time Agent Board starts, as long as a token is available from the environment or this PC's secure storage. Without one, the dialog asks for the token.

## Get notifications on an iPhone

An iPhone can receive notifications from the board once the board is on its Home Screen. No other notification app or account is needed.

1. Open the board's address in Safari on the iPhone and enter the passcode, so that the phone is registered.
2. Tap Share, choose **Add to Home Screen**, and add it.
3. Open **Agent Board** from the Home Screen icon, not from Safari.
4. Open the settings, choose **Notification settings** on the **Phone notifications** row, then choose **Enable notifications** at the top of the dialog and allow notifications when iOS asks.

To turn them off, choose **Turn off** in the same place. If you chose Don't Allow, the board keeps working; to allow notifications later, open the iPhone's Settings, choose Agent Board, and turn on Notifications. In a Safari tab that control only explains that the board must be added to the Home Screen first. Removing the phone in the dialog on the PC also stops its notifications, and they keep working after the PC restarts.

### What you are notified about {#notified-about}

The board sends only what you chose in the **Phone notifications** dialog, which you open from [Settings](./board.md#phone-notifications). At first that is results and questions that need your decision:

- A **result** arrives as soon as the first viewable version is saved, even while the work is still in progress, and each later version arrives too. Tap it to open that version.
- A **question** that needs your decision arrives with a high priority. Tap it to open the card with the question.
- **Card state changes** and **history additions** arrive only when you switch them on, and state changes only for the transitions you picked. Tap one to open the card.

With **Periodic status notification** on, the board also sends one notification every interval you chose (30 minutes, 1 hour, 2 hours, or 4 hours) about the cards in Doing, even if nothing new was recorded. It is separate from the choices above, and a first draft, a final result, or a question is never held back for it: those arrive at once. The first one comes one interval after the board starts or after the previous one. Each card in it says one of these:

- **New records.** How many records (history entries and results) were written since the previous report, with the time and content of the latest.
- **No new record.** It says so, with the time and content of the last record on the card. It does not say the work is still going on, because the board cannot tell that from old records.
- **Agent status.** Only when the card's run state on the board is *running* or *waiting for your answer* does the report say so. A running card is described as what the agent reports about itself (a self-report), not as something the board has confirmed.

Nothing is sent when no card is in Doing. Tap the notification to open the card, or the project when it lists several cards.

If one change matches several of the kinds you chose, for example a question that also makes the card wait, you get one notification, and it opens the result or the question. The same result or question is never shown twice on a phone, even if the board reads it again.

Notifications carry a link, so they are sent only while the remote connection is up. If the connection is paused or the PC is off, nothing is sent for that time, and the board still shows everything. If the push service does not accept a notification, the board tries again a few times with growing pauses and then gives up; the result stays readable on the board either way. Notifications are encrypted from the PC to your phone; see [Security](../../dev/concepts/security.md#the-ngrok-entrance) for what the push service can see.

## Check that ngrok keeps no traffic content

ngrok's Traffic Inspector can keep request details if **Full Capture** is turned on for your account. Agent Board cannot turn it off for you. In the ngrok dashboard, open **Settings** → **Observability** and confirm that Full Capture is disabled. Do this before you use the monitor.

## Keep the same address

By default ngrok chooses a new address at every start, so a bookmark or a home-screen icon on the phone stops working after the connection restarts. To keep one address, give Agent Board a domain that your ngrok account owns, such as the free static dev domain shown on the ngrok dashboard under **Domains**. The **Remote connection** dialog has an **ngrok domain** field marked **Recommended**. It is optional, but without it the address changes every time the connection starts. Enter the domain, for example `name.ngrok-free.dev`, and choose **Save and connect**. The domain is saved on this PC, so you do not enter it again.

The value is a bare host name, without a scheme, a path, or a port. When the connection starts, Agent Board asks ngrok for that domain, so the address is the same after you stop and start the connection and after the server restarts.

As an alternative to the dialog, set the `AGBOARD_NGROK_DOMAIN` environment variable before the server starts:

```sh
export AGBOARD_NGROK_DOMAIN=<your domain, for example name.ngrok-free.dev>
```

If the variable is set, it is used instead of the saved domain. The dialog then shows it and the field cannot be edited. Opening the address still shows the passcode screen, and the passcode is new at every start. When you stop the connection, the address no longer reaches the board.

If ngrok refuses the domain, for example because your account does not own it, the connection fails to start and the reason is written to the server log. If the field holds something that is not a plain host name, the dialog asks you to correct it. To go back to an address that ngrok chooses, clear the field.

## Start it from the command line

To start the connection with the server, set the token in the environment:

```sh
export NGROK_AUTHTOKEN=<your authtoken>
agboard serve --monitor ngrok
```

The command prints the phone address and the passcode with the local address, for example `Serving at http://127.0.0.1:7420/; remote access at https://… with passcode 4821`, or in the `monitor` field with `--json`. The passcode changes each time the server starts. If the connection cannot start, `serve` stops with exit code 1. The other options are in the [CLI guide](../reference/cli).

When the computer sleeps or the server stops, the monitor is unavailable until the server and the connection run again. A server that an agent's command started keeps the saved connection and does not stop by itself while the phone is connected; stop the connection on the PC to let it stop.

## Check on a phone

On a tablet or phone, the page keeps the height it had before the software keyboard opened, so the lanes do not jump. While the keyboard is open, a dialog that is normally centered moves to the top of the visible area and shrinks to fit above the keyboard, in portrait and in landscape, so its title, the field you type in, and its buttons stay visible while the middle of the dialog scrolls; the answer sheet keeps its top on screen. Responsive browser tests cover narrow viewports; the software keyboard needs a real-device check. Open the monitor in the phone's browser and open the answer sheet of a Todo or Doing task with a Pending question. Confirm that the keyboard leaves the answer field and the Previous and Next buttons reachable, then send the answer with Send on its last question. Also check scrolling in long Body, Conditions, and Epic tabs, horizontal tab swipes, and downward dismissal from the handle and header. Browser emulation alone does not verify Safari's keyboard behavior.

## Next

- [Decisions](../delegate/decisions): answer a question from your phone.
- [Troubleshooting](../operations/troubleshooting): the page does not load or does not update.
