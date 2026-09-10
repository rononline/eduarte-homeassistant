import {strict as assert} from "assert";
import {test} from "node:test";
import {findAjaxUrl, parseAgenda} from "./eduarte-api";
import {AbsenceStatus} from "./objects/absenceStatus";

const page = `
<html><body>
<div class="agenda-list">
  <div class="agenda-title">dinsdag 1 september</div>
  <table>
    <tr><th>Tijd</th><th>Les</th></tr>
    <tr>
      <td class="agenda-time"><span class="top">08:30</span><span class="bottom">09:20</span></td>
      <td class="agenda-class">A1.02 - Nederlands - MBO4A - J. de Vries</td>
      <td class="agenda-homework">Hoofdstuk 3 lezen</td>
      <td><span class="is-completed"></span></td>
    </tr>
    <tr>
      <td class="agenda-time"><span class="top">09:30</span><span class="bottom">10:20</span></td>
      <td class="agenda-class">B2.11 - Rekenen - MBO4A - P. Jansen</td>
      <td class="agenda-homework"></td>
      <td><span class="icon-absent-1"></span></td>
    </tr>
  </table>
  <div class="agenda-title">woensdag 2 september</div>
  <table>
    <tr>
      <td class="agenda-time"><span class="top">10:00</span><span class="bottom">11:50</span></td>
      <td class="agenda-class">C0.01 - Burgerschap - MBO4A - K. Bakker</td>
    </tr>
  </table>
</div>
</body></html>`;

test("parses school days, lessons and absence status", () => {
    const days = parseAgenda(page, new Date(2026, 7, 29));

    assert.equal(days.length, 2);
    assert.equal(days[0].dateKey, "2026-09-01");
    assert.equal(days[1].dateKey, "2026-09-02");
    assert.equal(days[0].subjects.length, 2, "the header row must not become a lesson");

    const dutch = days[0].subjects[0];
    assert.equal(dutch.name, "Nederlands");
    assert.equal(dutch.location, "A1.02");
    assert.equal(dutch.className, "MBO4A");
    assert.equal(dutch.teacher, "J. de Vries");
    assert.equal(dutch.homework, "Hoofdstuk 3 lezen");
    assert.equal(dutch.absenceStatus, AbsenceStatus.PRESENT);
    assert.equal(dutch.startTimeObject?.getHours(), 8);
    assert.equal(dutch.startTimeObject?.getMinutes(), 30);
    assert.equal(dutch.endTimeObject?.getHours(), 9);

    assert.equal(days[0].subjects[1].absenceStatus, AbsenceStatus.ABSENT);
    assert.equal(days[1].subjects[0].absenceStatus, AbsenceStatus.NOT_REGISTERED);
});

test("lesson ids are stable and unique per lesson", () => {
    const first = parseAgenda(page, new Date(2026, 7, 29));
    const second = parseAgenda(page, new Date(2026, 8, 3));
    const ids = first.flatMap(day => day.subjects.map(subject => subject.id));

    assert.deepEqual(ids, second.flatMap(day => day.subjects.map(subject => subject.id)));
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids[0], "2026-09-01-0830-nederlands");
});

// the layout this school's portal actually returns: one element per field.
const structuredPage = `
<html><body>
<div class="agenda-list">
  <div class="agenda-title">woensdag 2 september</div>
  <table class="table table-borderless"><tbody>
    <tr class="clickable-row">
      <td class="agenda-item"><div>1-10</div></td>
      <td class="agenda-time">
        <span class="agenda-time top">7:30</span><br/>
        <span class="agenda-time bottom">16:00</span>
      </td>
      <td class="agenda-details">
        <span class="agenda-class"> Introductieactiviteit</span><br/>
        <span class="agenda-teacher">franko, jevelu</span>
      </td>
      <td class="agenda-homework-icon"></td>
      <td class="agenda-homework"></td>
      <td class="agenda-presence-icon"></td>
      <td class="agenda-location">B1.14</td>
    </tr>
  </tbody></table>
</div>
</body></html>`;

test("reads the per-element layout instead of splitting on dashes", () => {
    const days = parseAgenda(structuredPage, new Date(2026, 8, 1));
    const lesson = days[0].subjects[0];

    assert.equal(lesson.name, "Introductieactiviteit");
    assert.equal(lesson.teacher, "franko, jevelu");
    assert.equal(lesson.location, "B1.14");
    assert.equal(lesson.lessonHours, "1-10");
    // times without a leading zero must still parse.
    assert.equal(lesson.startTimeObject?.getHours(), 7);
    assert.equal(lesson.startTimeObject?.getMinutes(), 30);
    assert.equal(lesson.endTimeObject?.getHours(), 16);
    // the hour is padded so the id is stable if the portal changes its formatting.
    assert.equal(lesson.id, "2026-09-02-0730-introductieactiviteit");
});

test("leaves fields undefined when the portal renders them empty", () => {
    const days = parseAgenda(structuredPage.replace(">franko, jevelu<", "><").replace(">B1.14<", "><"), new Date(2026, 8, 1));
    const lesson = days[0].subjects[0];

    assert.equal(lesson.teacher, undefined);
    assert.equal(lesson.location, undefined);
    assert.equal(lesson.name, "Introductieactiviteit");
});

test("treats a week without lessons as empty, not as a failure", () => {
    // what the portal returns during the holidays.
    const empty = `<html><body><div class="agenda-list">
      <div class="empty">Er zijn geen afspraken voor deze week.</div>
    </div></body></html>`;

    assert.deepEqual(parseAgenda(empty, new Date(2026, 7, 29)), []);
});

test("fails loudly when the agenda is not in list view", () => {
    assert.throws(() => parseAgenda("<html><body>login</body></html>"), /Agenda element has not been found/);
});

// the page publishes its own AJAX endpoints; the version number in the query
// string moves as the page re-renders, so it must be read rather than built.
const scriptedPage = `<html><body><script>
Wicket.Ajax.ajax({"u":"./agenda?4-1.0-filter-datum&op=4","m":"POST","c":"id57","e":"change"});;
Wicket.Ajax.ajax({"u":"./agenda?4-1.0-filter-weergaveKiezer-choicesContainer-enumHiddenField&op=4","m":"POST","c":"id58","e":"change"});;
</script></body></html>`;

test("reads the current AJAX endpoint out of the page", () => {
    assert.equal(findAjaxUrl(scriptedPage, "filter-datum"), "4-1.0-filter-datum");
    assert.equal(
        findAjaxUrl(scriptedPage, "filter-weergaveKiezer-choicesContainer-enumHiddenField"),
        "4-1.0-filter-weergaveKiezer-choicesContainer-enumHiddenField"
    );
});

test("picks up a bumped page version instead of assuming 1.0", () => {
    const rerendered = scriptedPage.replace(/\?4-1\.0-/g, "?4-7.0-");
    assert.equal(findAjaxUrl(rerendered, "filter-datum"), "4-7.0-filter-datum");
});

test("returns undefined when the component is absent", () => {
    assert.equal(findAjaxUrl("<html></html>", "filter-datum"), undefined);
});

// the real markup this portal produces once a lesson has been registered.
function rowWithPresence(cell: string): string {
    return `<html><body><div class="agenda-list">
      <div class="agenda-title">woensdag 9 september</div>
      <table><tbody><tr class="clickable-row">
        <td class="agenda-item"><div>1-2</div></td>
        <td class="agenda-time"><span class="agenda-time top">8:30</span><span class="agenda-time bottom">10:00</span></td>
        <td class="agenda-details"><span class="agenda-class">Nederlands 2F</span><span class="agenda-teacher">misbge</span></td>
        <td class="agenda-homework"></td>
        <td class="agenda-presence-icon">${cell}</td>
        <td class="agenda-location">B109</td>
      </tr></tbody></table>
    </div></body></html>`;
}

const reference = new Date(2026, 8, 9);

test("reads a registered presence and keeps the raw marker", () => {
    const page = rowWithPresence('<i class=" flaticon calendar-2 is-completed"></i>');
    const lesson = parseAgenda(page, reference)[0].subjects[0];

    assert.equal(lesson.absenceStatus, AbsenceStatus.PRESENT);
    assert.equal(lesson.absenceMarker, "flaticon calendar-2 is-completed");
});

test("treats any other registered marker as not present", () => {
    // the exact class for an absence is unknown; anything registered that is not
    // 'is-completed' must not be mistaken for a clean attendance.
    const lesson = parseAgenda(rowWithPresence('<i class="flaticon calendar-2 is-absent"></i>'), reference)[0].subjects[0];

    assert.equal(lesson.absenceStatus, AbsenceStatus.ABSENT);
    assert.equal(lesson.absenceMarker, "flaticon calendar-2 is-absent");
});

test("an empty presence cell means nothing was registered", () => {
    const lesson = parseAgenda(rowWithPresence(""), reference)[0].subjects[0];

    assert.equal(lesson.absenceStatus, AbsenceStatus.NOT_REGISTERED);
    assert.equal(lesson.absenceMarker, undefined);
});

test("an icon elsewhere in the row does not count as presence", () => {
    // a homework icon must not be read as an attendance registration.
    const page = rowWithPresence("").replace(
        '<td class="agenda-homework"></td>',
        '<td class="agenda-homework-icon"><i class="flaticon book"></i></td><td class="agenda-homework"></td>'
    );
    assert.equal(parseAgenda(page, reference)[0].subjects[0].absenceStatus, AbsenceStatus.NOT_REGISTERED);
});
