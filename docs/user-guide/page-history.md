# Page history

## Why a saved edit may not appear yet

Saving a page and creating a history version are separate steps. Your saved edit
can already be visible on the page while **Page history** still shows an older
version. This does not, by itself, mean the edit failed to save.

WrenLore groups browser edits into periodic snapshots instead of creating a
version for every keystroke:

| Page age when the edit is saved | Usual snapshot delay |
| --- | --- |
| Less than five minutes old | About one minute |
| Five minutes old or more | About five minutes |

The window starts with the first saved edit that needs a snapshot. Further edits
join that window without restarting the timer. For example, on an established
page, edits at 10:00 and 10:03 would normally appear together in a snapshot shortly
after 10:05. These are target delays; processing or a service interruption can make
them longer.

## Check an edit in history

1. Open the page menu and select **Page history**.
2. Read the status notice in the history dialog.
3. If a snapshot is pending, allow the grouping window to finish. The open history
   dialog refreshes automatically every five seconds; you do not need to close and
   reopen it.
4. Select the new version to review it. If you were viewing an older version, that
   selection stays in place when the new version arrives.

The notices mean:

- **“Your page is saved. A history snapshot is pending.”** The edit has been saved
  and a snapshot is scheduled, but it is not a history version yet.
- **“Your page is saved. Its history snapshot is delayed and will be retried.”**
  Saving the snapshot encountered a problem. WrenLore retains the pending work and
  retries automatically; this notice does not mean your page edit was lost.
- **“No page history saved yet.”** There are no snapshots to display yet. On a new
  page, check the accompanying status notice before assuming something failed.

If the pending notice remains well beyond the usual window, or the delayed notice
persists, contact your administrator with the page name, approximate edit time,
and notice shown. You do not need to repeat the edit just to trigger history.

## Understanding the displayed time

Each version's timestamp is when that snapshot was captured, not the time of your
most recent edit or the current time. While a new snapshot is pending, the older
versions keep their original timestamps.

Times use your browser's local timezone. The display currently uses a 12-hour
clock with AM/PM: for example, **7:05 PM** means **19:05**, and **2:39 AM** means
**02:39**. This is a display format, not a different timezone.

## What a snapshot contains

A snapshot records the page state at capture time. Several edits can therefore
appear in one version; intermediate states within the window are not separate
versions. If the page ends up unchanged from its last snapshot, WrenLore does not
create a duplicate version.

History is not a record of every individual action. It also cannot reconstruct
older page states that were never captured. Administrators can read the
[page-history operations notes](../page-history.md) for persistence and recovery
details.
