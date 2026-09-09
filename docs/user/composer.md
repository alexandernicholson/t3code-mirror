# Messages and context

Give the agent a task in the composer. Add files, quote a previous response, or
include a skill when the task needs more context.

Messages can contain up to 120,000 characters. Longer drafts stay in the composer
so you can shorten them or split them into several messages.

## Attach files

Attach up to eight files per message. Images can be up to 10 MB; other files can
be up to 50 MB, subject to the environment's upload support and limit. The agent
receives them on the environment's machine.

Uploads begin when you add an attachment. All uploads must finish before the
message can send. Retry or remove a failed upload. On web and desktop, reloading
before an upload finishes requires you to attach that file again.

You can drag or paste images into the web or desktop composer. HEIC and HEIF
photos are converted to JPEG there and when selected from the iOS photo library;
the image limit applies after conversion. On mobile, you can also send files to
T3 Code through another app's system share sheet.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Steer or queue a message

While the agent is working, use the delivery selector beside Send. Choose
**Steer** to send a correction into the agent's current work. Choose
**Queue** to let the current turn finish first. Queued messages run in order,
one at a time, and remain on the environment when you close a client.
On web and desktop, Cmd/Ctrl+Enter queues the current draft directly.

Queued messages appear above the editor. Open a message's actions to edit,
remove, or send it immediately. **Edit**
returns its text, attachments, and settings to the composer, preserving any
existing draft. Once a message has started, it can no longer be taken back.
Stopping pauses pending messages; use **Resume queue** when ready to continue.
Commands such as `/compact` must be sent directly.

## Send messages offline on mobile

Mobile keeps local copies of draft attachments, so you can preview them and queue
messages while disconnected. Uploads resume when you reconnect. Drafts and queued
messages survive app restarts. Signing out of T3 Connect keeps that work on your
device until you sign back into the same account.

The Steer/Queue selector keeps your delivery choice when reconnecting. A message
waiting for a connection has not yet reached the environment's queue. Queueing
requires an environment version that supports the feature.

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

T3 Code remembers your provider, model, and model options for new threads. A
project's configured model takes precedence; resetting that project setting
returns to the remembered selection.

Leaving reasoning level or service tier unset uses the provider's own configuration.

## Quote an assistant response

On web and desktop, select text within one assistant response and choose
**Cite in composer**. You can add a comment about the quote and write instructions
around it.

Select the quote in a draft or sent message to return to its source. If the source
is unavailable or has changed, the saved quote remains readable.

Mobile displays saved quotes and comments, but does not create citations or
navigate to their sources.

## Recall a sent prompt

Press `ArrowUp` in an empty composer to bring back the last prompt you sent in this thread. Press
`ArrowUp` again to go further back, and `ArrowDown` to come forward. Moving forward past the newest
prompt clears the composer. Recall walks the prompts loaded in the thread. Attachments, terminal
context, and other extras from the original message are not restored, only the text you typed. A
composer that holds an attachment or a picked element does not count as empty.

When the composer has text, the arrow keys move the caret as usual. Recall takes over only while
the text is an unedited recalled prompt, with the caret on the first visual line for `ArrowUp` or
the last visual line for `ArrowDown`, counting wrapped lines. Editing a recalled prompt turns it
into a normal draft.

## Prompt stash

On web and desktop, press `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux to save
the current prompt and its attachments for later. Wait for uploads to finish first.
With an empty composer, the same shortcut restores a single stash or opens the
stash menu when there are several.

Stashes containing uploaded files must be restored in their original environment.
Those files are retained for 24 hours. After an upload expires, restore the prompt
and use **Attach again** or remove the missing file before sending.

## Voice input on iPhone

On supported iPhones with iOS 26 or later, use the composer's microphone to record,
then confirm to transcribe. Text is inserted where your selection was when
recording started, ready for you to review and edit before sending.

The first use may download Apple's speech model and needs a network connection.
Later transcription works offline for that language. Recordings can be up to five
minutes long. Canceling, leaving the screen, or an audio interruption discards the
recording and preserves your existing draft.

Transcription runs on your device. T3 Code deletes the temporary audio after
transcription or cancellation; only the message text is sent when you submit.

## Commands and skills

Type `/` for commands or `$` to add a skill from the selected environment and
provider. On mobile, both are also available before starting a thread on
**New task**.

The slash menu also includes skills unless you turn off **Settings → General →
Show skills in slash menu**. Only skills enabled for the provider are listed.

Provider commands must start the message to run. T3 Code commands such as
`/model` and `/plan`, and skill mentions, work on any line.

Send `/compact` in an existing conversation to reduce context usage when the
provider supports it. Web and desktop also offer compaction from the context meter.

## Images and videos in messages

Select an image or video attachment or link to preview it. Playback support depends
on your browser or device; save an unsupported video to open it in another app.

On web and desktop, right-click media to save it or copy its path or URL. On mobile,
touch and hold an image or video thumbnail and choose **Save or share**. On iOS,
return to the thumbnail to open this menu after watching a full-screen video.

File links refer to the environment's machine, including when you connect remotely.
Previews use the original file, even outside the workspace. Moving or deleting it
can break the preview, so save a copy if you need to keep it.

## Files outside the workspace

Follow an agent's file link to read a report or other file outside the workspace.
These files open read-only. An HTML file outside the workspace cannot load scripts,
styles, or images from neighboring files.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open as rendered pages. Switch an HTML
file to source view to read its markup; a link to a specific line opens source
automatically. HTML previews cannot access your T3 Code session.

On mobile, select a PDF attachment or link to open it. iOS uses the native viewer;
Android opens the system chooser.

## Voice narration

On web and desktop, select **Narrate** in a thread to hear brief model-generated summaries of new agent messages as work progresses. Select it again to stop immediately. Leaving the thread stops narration; returning does not replay earlier messages. Code blocks and tool output are skipped. On mobile, narration also stops when the app goes into the background.

Kitten Nano generates English speech on your device without a GPU or a speech-service account. The first preview or narration downloads about 28 MB of model and voice files from Hugging Face, with progress shown while downloading. Web uses a browser cache; mobile stores the model and pronunciation data on the device. Speech generation works offline with those downloads; summarizing new updates still requires a connection to your environment and its model provider. Clearing browser/site data or removing the download means it must be downloaded again.

Choose among eight voices, adjust speed, preview speech, or remove the downloaded model in **Settings → General → Voice narration** on web/desktop, or **Settings → Voice narration** on mobile. On web/desktop you can also choose **System voices**; their availability depends on the device and browser, and some use an online speech service. Preferences apply on this device the next time you start narration.

In web/desktop Voice narration settings, choose a **Narration summary model** or use the environment’s text generation default. The model and option controls match chat, including reasoning effort, context window, and service tier where supported. Customize **Narration instructions** to focus on the updates you care about. The default asks for one plain-language sentence of at most 20 words. These settings apply to the next update in the web and desktop clients connected to that environment. Reset the model or instructions to return to the defaults.

## TODOs

Open **TODOs** in the right sidebar to see the thread's checklist, including after
an agent finishes. On mobile, open TODOs from the thread toolbar. Changes also
appear in the conversation, so you can follow progress with the checklist closed. Ask the agent to create a checklist, or add items yourself.
You can edit the text and phase, mark items complete or reopen them, move them up
or down, and delete them. On web and desktop, use **Toggle TODOs** in the command
palette or Cmd/Ctrl+Alt+T; customize the shortcut in Settings → Keybindings.

Edits are saved to the environment and synchronized across connected clients.
The agent receives your current list with your next ordinary message; send a
follow-up if it should act on the changes now. Changing a checkbox does not stop
running work. TODO edits require a connected environment with TODO support.

## Advisors

Advisors provide an independent review while an agent works. In **Settings → Agents**
on web or desktop, or **Settings → Advisors** on mobile, add a reviewer, choose its
account and model, and enable it for all projects or selected projects. Review
activity is sent to that account's provider. Read-only reviewer sessions currently
require Claude Code; they can watch threads using any T3 provider. Use the same model picker as chat to choose the account, model, and supported options such as effort and context window.

Open **Advisors** from the right panel, the command palette, or `/advisor`. An enabled
advisor's status remains visible with the panel closed. On mobile, tap the advisor
status to open its timeline. The timeline shows review activity, findings, delivery
status, and reported usage. Opening a finding does not mean it has been resolved.

Choose **Guide automatically** to send concerns and blockers into active work, or
**Observe only** to decide yourself. Finished or stopped threads stay stopped; use
**Ask agent to address** to continue with a finding. Plan mode also waits for your
input. Closing the panel does not stop reviews. Use Pause/Resume in the panel, or
`/advisor pause` and `/advisor resume`. A project-level pause still applies when a
thread is resumed.

Use the panel's settings control to override the thread's selected advisors.
Project guidance can be entered in Settings or loaded from a workspace file such
as `WATCHDOG.md`. Changes apply to subsequent reviews. An unavailable reviewer
shows its reason; correct its settings and resume it to retry. Reviews and history
live on the environment and continue when a client disconnects. Enabling an advisor
starts watching current activity rather than reviewing the entire old conversation.
