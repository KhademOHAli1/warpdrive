import assert from "node:assert/strict";

const date = "2030-06-17";
const nextDate = "2030-06-18";
const subject = "CI calendar pointer event";

function surface(page, kind, iso) {
  return page.locator(`[data-calendar-surface="${kind}"][data-calendar-date="${iso}"]`);
}

async function bounds(locator, description) {
  await locator.waitFor({ state: "visible" });
  const box = await locator.boundingBox();
  assert.ok(box !== null && box.width > 0 && box.height > 0, description);
  return box;
}

async function painted(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

// Set up stable scroll geometry only. The gestures below use Chromium's actual mouse events;
// they do not dispatch DOM events, call application handlers, or replace network responses.
async function parkTimedRange(page, firstMinute, lastMinute, iso = date) {
  const column = surface(page, "time", iso);
  await column.waitFor();
  await page.locator("[data-agenda-scroll]").scrollIntoViewIfNeeded();
  await column.evaluate(
    (node, minutes) => {
      const host = node.closest("[data-agenda-scroll]");
      if (!(host instanceof HTMLElement)) throw new Error("Missing agenda scroll host");
      const clip = host.getBoundingClientRect();
      const pinned = host.querySelector(".sticky")?.getBoundingClientRect().height ?? 0;
      const top = Math.max(clip.top, 0) + pinned + 24;
      const bottom = Math.min(clip.bottom, window.innerHeight) - 24;
      const box = node.getBoundingClientRect();
      host.scrollTop += box.top + (box.height * minutes) / 1440 - (top + bottom) / 2;
    },
    (firstMinute + lastMinute) / 2,
  );
  await painted(page);
  return column;
}

function timePoint(box, minute) {
  return { x: box.x + box.width * 0.65, y: box.y + (box.height * minute) / 1440 };
}

async function drag(page, from, to, beforeRelease) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    await page.mouse.move(to.x, to.y, { steps: 8 });
    if (beforeRelease !== undefined) await beforeRelease();
  } finally {
    await page.mouse.up();
  }
}

function dateLabel(iso) {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

async function assertSchedule(dialog, calendar, iso, start, end) {
  await dialog.getByRole("textbox", { name: calendar.editor.startTime, exact: true }).waitFor();
  assert.equal(
    await dialog
      .getByRole("textbox", { name: calendar.editor.startTime, exact: true })
      .inputValue(),
    start,
    "Persisted event start time",
  );
  assert.equal(
    await dialog.getByRole("textbox", { name: calendar.editor.endTime, exact: true }).inputValue(),
    end,
    "Persisted event end time (duration is retained)",
  );
  for (const label of [calendar.editor.startDate, calendar.editor.endDate]) {
    assert.equal(
      (await dialog.getByRole("button", { name: label, exact: true }).textContent())?.trim(),
      dateLabel(iso),
      "The editor retains the expected civil date",
    );
  }
  assert.equal(
    await dialog.getByRole("checkbox", { name: calendar.allDay, exact: true }).isChecked(),
    false,
  );
}

async function checkPersistedEvent(page, calendar, id, iso, start, end, touch = false) {
  await page.reload();
  const chip = page.locator(`[data-calendar-event-id="${id}"]`);
  await chip.waitFor();
  if (touch) await chip.tap();
  else await chip.click();
  const dialog = page.getByRole("dialog");
  await assertSchedule(dialog, calendar, iso, start, end);
  assert.equal(
    await dialog
      .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
      .inputValue(),
    subject,
  );
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

async function shiftDayEvent(page, id, minutes, edge) {
  await parkTimedRange(page, 600, 825);
  const chip = page.locator(`[data-calendar-event-id="${id}"]`);
  const handle = edge === undefined ? chip : chip.locator(`[data-calendar-resize-edge="${edge}"]`);
  const box = await bounds(handle, "Event chip or resize grip");
  const column = await bounds(surface(page, "time", date), "Day surface");
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(page, from, { x: from.x, y: from.y + (column.height * minutes) / 1440 });
}

async function assertTouchMove(page, calendar) {
  await page.goto(`/activities/calendar?view=day&d=${nextDate}`);
  const chip = page.locator("[data-calendar-event-id]").filter({ hasText: subject });
  await chip.waitFor();
  const id = await chip.getAttribute("data-calendar-event-id");
  assert.ok(id, "The event moved on desktop is available on touch");
  await checkPersistedEvent(page, calendar, id, nextDate, "12:15", "13:30", true);

  const session = await page.context().newCDPSession(page);
  const touch = (type, point) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: point === undefined ? [] : [{ ...point, id: 1 }],
    });
  try {
    await parkTimedRange(page, 735, 885, nextDate);
    const box = await bounds(chip, "Event chip before quick swipe");
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const scroll = page.locator("[data-agenda-scroll]");
    const before = await scroll.evaluate((node) => node.scrollTop);
    await touch("touchStart", start);
    await touch("touchMove", { x: start.x, y: start.y - 18 });
    await touch("touchMove", { x: start.x, y: start.y - 75 });
    await touch("touchEnd");
    await page.waitForFunction(
      (previous) => (document.querySelector("[data-agenda-scroll]")?.scrollTop ?? 0) > previous + 5,
      before,
    );
    assert.equal(await page.getByRole("dialog").count(), 0, "A swipe still scrolls the agenda");
    await checkPersistedEvent(page, calendar, id, nextDate, "12:15", "13:30", true);

    const column = await parkTimedRange(page, 735, 885, nextDate);
    const day = await bounds(column, "Touch day surface");
    const event = await bounds(chip, "Event chip before long press");
    const from = { x: event.x + event.width / 2, y: event.y + event.height / 2 };
    await touch("touchStart", from);
    try {
      await chip.and(page.locator('[data-calendar-dragging="true"]')).waitFor();
      await touch("touchMove", { x: from.x, y: from.y + (day.height * 60) / 1440 });
      await painted(page);
    } finally {
      await touch("touchEnd");
    }
    await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
    assert.equal(
      await page.getByRole("dialog").count(),
      0,
      "A touch drop does not open the editor",
    );
    await checkPersistedEvent(page, calendar, id, nextDate, "13:15", "14:30", true);
  } finally {
    await session.detach();
  }
}

export async function runCalendarInteractionsBrowserSmoke({ journey, login, catalog }) {
  const calendar = catalog("src/features/activities/messages/calendar.en.json");
  await journey(
    "calendar-interactions",
    "en",
    async (page) => {
      await login(page);
      await page.goto(`/activities/calendar?view=day&d=${date}`);
      await surface(page, "time", date).waitFor();
      assert.equal(
        await page.locator("[data-calendar-event-id]").count(),
        0,
        "Future fixture day is empty",
      );

      const column = await parkTimedRange(page, 600, 660);
      const box = await bounds(column, "Full 24-hour day surface");
      // Include the 10:45 quarter-hour slot, ending before the 11:00 slot starts.
      await drag(page, timePoint(box, 601), timePoint(box, 659));
      const dialog = page.getByRole("dialog");
      await assertSchedule(dialog, calendar, date, "10:00", "11:00");
      await dialog
        .getByRole("textbox", { name: calendar.editor.eventTitle, exact: true })
        .fill(subject);
      await dialog.locator('button[type="submit"]').click();
      await dialog.waitFor({ state: "hidden" });
      const created = page.locator("[data-calendar-event-id]").filter({ hasText: subject });
      await created.waitFor();
      const id = await created.getAttribute("data-calendar-event-id");
      assert.ok(id, "The drawn event receives a persisted ID");
      await checkPersistedEvent(page, calendar, id, date, "10:00", "11:00");

      await shiftDayEvent(page, id, 120);
      await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
      assert.equal(
        await page.getByRole("dialog").count(),
        0,
        "Trailing drag click does not open the editor",
      );
      await page.getByRole("button", { name: calendar.interaction.undo, exact: true }).click();
      await page.getByText(calendar.interaction.undoSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "10:00", "11:00");

      await shiftDayEvent(page, id, 120);
      await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "12:00", "13:00");

      await shiftDayEvent(page, id, 15, "start");
      await page.getByText(calendar.interaction.resizeSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "12:15", "13:00");
      await shiftDayEvent(page, id, 30, "end");
      await page.getByText(calendar.interaction.resizeSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, date, "12:15", "13:30");

      // A cancelled active drag must neither invoke a server action nor change stored time.
      await parkTimedRange(page, 720, 900);
      let actionRequests = 0;
      const recordAction = (request) => {
        if (request.method() === "POST" && request.headers()["next-action"] !== undefined)
          actionRequests++;
      };
      page.on("request", recordAction);
      try {
        const before = actionRequests;
        const current = await bounds(
          page.locator(`[data-calendar-event-id="${id}"]`),
          "Chip for cancellation",
        );
        const day = await bounds(surface(page, "time", date), "Day for cancellation");
        const origin = { x: current.x + current.width * 0.65, y: current.y + current.height / 2 };
        await drag(
          page,
          origin,
          { x: origin.x, y: origin.y + (day.height * 120) / 1440 },
          async () => {
            await page
              .locator(`[data-calendar-event-id="${id}"][data-calendar-dragging="true"]`)
              .waitFor();
            await page.keyboard.press("Escape");
          },
        );
        await painted(page);
        assert.equal(actionRequests, before, "Escape sends no mutation action");
        assert.equal(
          await page.getByRole("dialog").count(),
          0,
          "Cancelled drag suppresses its click",
        );
      } finally {
        page.off("request", recordAction);
      }
      await checkPersistedEvent(page, calendar, id, date, "12:15", "13:30");

      await page.goto(`/activities/calendar?view=month&d=${date}`);
      const nextCell = surface(page, "date", nextDate);
      await nextCell.scrollIntoViewIfNeeded();
      const monthChip = await bounds(
        page.locator(`[data-calendar-event-id="${id}"]`),
        "Month event chip",
      );
      const destination = await bounds(nextCell, "Next date cell");
      await drag(
        page,
        { x: monthChip.x + monthChip.width / 2, y: monthChip.y + monthChip.height / 2 },
        { x: destination.x + destination.width / 2, y: destination.y + destination.height - 12 },
      );
      await page.getByText(calendar.interaction.moveSaved, { exact: true }).waitFor();
      await checkPersistedEvent(page, calendar, id, nextDate, "12:15", "13:30");
      assert.equal(
        await surface(page, "date", date).locator(`[data-calendar-event-id="${id}"]`).count(),
        0,
      );
      assert.equal(
        await surface(page, "date", nextDate).locator(`[data-calendar-event-id="${id}"]`).count(),
        1,
      );

      const firstDate = "2030-06-20";
      const lastDate = "2030-06-22";
      const first = await bounds(surface(page, "date", firstDate), "All-day range start");
      const last = await bounds(surface(page, "date", lastDate), "All-day range end");
      await drag(
        page,
        { x: first.x + first.width / 2, y: first.y + first.height - 12 },
        { x: last.x + last.width / 2, y: last.y + last.height - 12 },
      );
      await dialog.waitFor();
      assert.equal(
        await dialog.getByRole("checkbox", { name: calendar.allDay, exact: true }).isChecked(),
        true,
      );
      assert.equal(
        await dialog.locator("[data-time-picker]").count(),
        0,
        "Date drawing opens an all-day draft",
      );
      assert.equal(
        (
          await dialog
            .getByRole("button", { name: calendar.editor.startDate, exact: true })
            .textContent()
        )?.trim(),
        dateLabel(firstDate),
      );
      assert.equal(
        (
          await dialog
            .getByRole("button", { name: calendar.editor.endDate, exact: true })
            .textContent()
        )?.trim(),
        dateLabel(lastDate),
      );
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      await page.reload();
      await page.locator(`[data-calendar-event-id="${id}"]`).waitFor();
      assert.equal(
        await page.locator("[data-calendar-event-id]").count(),
        1,
        "Cancelling the range draft creates nothing",
      );
    },
    { width: 1440, height: 1100 },
  );
  await journey(
    "calendar-touch-interactions",
    "en",
    async (page) => {
      await login(page);
      await assertTouchMove(page, calendar);
    },
    { width: 390, height: 844 },
    true,
  );
}
