
"use strict";

/* STUDYX — OBSIDIAN AURORA
   Browser-based study planner. Data is stored locally on this device.
*/

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const STORAGE_KEY = "studyx_aurora_v1";

const MODULES = {
  tasks: { title: "Task", fields: [
    ["title","Task name","text",true],["subject","Subject","text",false],
    ["due","Due date","date",false],["priority","Priority","select",false,["Low","Normal","High"]],
    ["description","Details","textarea",false]
  ]},
  exams: { title: "Exam", fields: [
    ["title","Exam name","text",true],["subject","Subject","text",false],
    ["date","Exam date","date",true],["description","Preparation notes","textarea",false]
  ]},
  timetable: { title: "Study session", fields: [
    ["title","Session name","text",true],["subject","Subject","text",false],
    ["day","Day","select",true,["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]],
    ["time","Start time","time",true],["duration","Duration (minutes)","number",true],
    ["description","Details","textarea",false]
  ]},
  syllabus: { title: "Chapter", fields: [
    ["title","Chapter name","text",true],["subject","Subject","text",true],
    ["status","Progress","select",true,["Not started","In progress","Completed"]],
    ["description","Notes","textarea",false]
  ]},
  revision: { title: "Revision", fields: [
    ["title","Topic to revise","text",true],["subject","Subject","text",false],
    ["date","Revision date","date",true],["description","Revision notes","textarea",false]
  ]},
  notes: { title: "Note", fields: [
    ["title","Title","text",true],["subject","Subject","text",false],
    ["url","Resource link (optional)","url",false],["description","Notes or summary","textarea",false]
  ]},
  goals: { title: "Goal", fields: [
    ["title","Goal name","text",true],["target","Target description","text",false],
    ["due","Target date","date",false],["description","Why it matters","textarea",false]
  ]},
  reminders: { title: "Reminder", fields: [
    ["title","Reminder name","text",true],["date","Date","date",true],
    ["time","Time","time",false],["description","Details","textarea",false]
  ]}
};

const DEFAULT_STATE = () => ({
  version: 1,
  profile: null,
  plan: "Free",
  records: {
    tasks: [], exams: [], timetable: [], syllabus: [],
    revision: [], notes: [], goals: [], reminders: []
  },
  sessions: [],
  activeDays: [],
  preferences: { notifications: false }
});

let state = loadState();
let onboardingStep = 0;
let dialogType = null;
let editingId = null;
let confirmAction = null;
let calendarDate = new Date();
let selectedDate = dateKey(new Date());
let focusMinutes = 25;
let focusRemaining = 25 * 60;
let focusRunning = false;
let focusEndTime = 0;
let focusInterval = null;
let charts = {};
let lastReminderCheck = "";
let reminderCheckInterval = null;

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return DEFAULT_STATE();
    const base = DEFAULT_STATE();
    return {
      ...base, ...saved,
      profile: saved.profile || null,
      records: { ...base.records, ...(saved.records || {}) },
      sessions: Array.isArray(saved.sessions) ? saved.sessions : [],
      activeDays: Array.isArray(saved.activeDays) ? saved.activeDays : [],
      preferences: { ...base.preferences, ...(saved.preferences || {}) }
    };
  } catch {
    return DEFAULT_STATE();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    toast("Could not save. Storage may be full; try exporting your data.", true);
    return false;
  }
}

function id() {
  return crypto.randomUUID ? crypto.randomUUID() :
    Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);
}

function dateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(value, options = { day:"numeric", month:"short", year:"numeric" }) {
  const d = parseDate(value);
  return d ? d.toLocaleDateString(undefined, options) : "No date set";
}

function todayKey() {
  return dateKey(new Date());
}

function safeText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toast(message, error = false) {
  const node = document.createElement("div");
  node.className = "toast" + (error ? " error" : "");
  node.textContent = message;
  $("#toastRegion").appendChild(node);
  setTimeout(() => node.remove(), 3500);
}

function markActiveDay() {
  const today = todayKey();
  if (!state.activeDays.includes(today)) {
    state.activeDays.push(today);
    state.activeDays = state.activeDays.slice(-400);
  }
}

function streakCount() {
  const days = new Set(state.activeDays);
  let cursor = new Date();
  if (!days.has(dateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(dateKey(cursor)) && count < 400) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

function sessionsForDay(day) {
  return state.sessions.filter(s => s.date === day);
}

function minutesForDay(day) {
  return sessionsForDay(day).reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
}

function totalMinutes() {
  return state.sessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
}

function completedTasks() {
  return state.records.tasks.filter(x => x.completed).length;
}

function chaptersDone() {
  return state.records.syllabus.filter(x => x.status === "Completed").length;
}

function escapeAttr(value = "") {
  return escapeHTML(value);
}

/* ONBOARDING */
function showOnboardingStep(step) {
  onboardingStep = Math.max(0, Math.min(3, step));
  $$(".onboard-step").forEach(el => {
    el.classList.toggle("active", Number(el.dataset.step) === onboardingStep);
  });
  $("#stepLabel").textContent = ["WELCOME","PROFILE","YOUR WORKSPACE","READY"][onboardingStep];
  $("#onboardProgress").style.width = `${(onboardingStep + 1) * 25}%`;
  $("#backOnboard").hidden = onboardingStep === 0;
}

function fillReadyCard() {
  const p = state.profile;
  $("#readyName").textContent = `You're ready, ${p?.name || "student"}.`;
  $("#readyDetails").textContent =
    `${p?.className || "Your class"} · ${p?.board || "Your board"} · ${p?.goal || "Your study goal"}`;
}

$("#profileForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("#profileName").value.trim();
  const age = Number($("#profileAge").value);
  const className = $("#profileClass").value.trim();
  const board = $("#profileBoard").value;

  if (!name || !className || !board || age < 5 || age > 100) {
    toast("Please check your profile details.", true);
    return;
  }

  state.profile = {
    ...(state.profile || {}),
    name, age, className, board,
    goal: $("#profileGoal").value
  };
  if (!saveState()) return;
  fillReadyCard();
  showOnboardingStep(2);
});

$$("[data-next]").forEach(button => {
  button.addEventListener("click", () => {
    if (onboardingStep === 0) {
      showOnboardingStep(1);
    } else if (onboardingStep === 2) {
      fillReadyCard();
      showOnboardingStep(3);
    }
  });
});

$("#backOnboard").addEventListener("click", () => showOnboardingStep(onboardingStep - 1));

$("#launchApp").addEventListener("click", () => {
  if (!state.profile) {
    showOnboardingStep(1);
    return;
  }
  markActiveDay();
  saveState();
  $("#onboarding").hidden = true;
  $("#app").hidden = false;
  renderAll();
  goPage("dashboard");
});

function startApp() {
  if (state.profile) {
    $("#onboarding").hidden = true;
    $("#app").hidden = false;
    renderAll();
    goPage("dashboard");
  } else {
    $("#onboarding").hidden = false;
    $("#app").hidden = true;
    showOnboardingStep(0);
  }
}

/* NAVIGATION */
const PAGE_INFO = {
  dashboard: ["Dashboard","Your study space, organized."],
  tasks: ["Tasks","Assignments and study priorities."],
  exams: ["Exam center","Dates, countdowns and preparation."],
  timetable: ["Timetable","Your weekly study routine."],
  syllabus: ["Syllabus tracker","Subjects and chapter progress."],
  revision: ["Revision planner","Schedule topics to revisit."],
  focus: ["Focus room","Dedicated time for deep work."],
  calendar: ["Calendar","Your deadlines at a glance."],
  notes: ["Notes & resources","Your personal learning library."],
  goals: ["Goals & streaks","Build consistent study habits."],
  analytics: ["Analytics","Understand your study activity."],
  reminders: ["Reminders","Important dates and nudges."],
  subscription: ["Membership","Your STUDYX plan."],
  settings: ["Settings","Your profile and data."]
};

function goPage(page) {
  if (!PAGE_INFO[page]) return;
  $$(".page").forEach(el => el.classList.toggle("active", el.id === `page-${page}`));
  $$(".nav-item[data-page]").forEach(el => el.classList.toggle("active", el.dataset.page === page));
  $("#topbarTitle").textContent = PAGE_INFO[page][0];
  $("#topbarSubtitle").textContent = PAGE_INFO[page][1];
  closeSidebar();

  if (page === "calendar") renderCalendar();
  if (page === "analytics") renderAnalytics();
  if (page === "settings") renderSettings();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.addEventListener("click", event => {
  const pageButton = event.target.closest("[data-page]");
  if (pageButton) {
    event.preventDefault();
    goPage(pageButton.dataset.page);
  }

  const addButton = event.target.closest("[data-add]");
  if (addButton) openItemDialog(addButton.dataset.add);

  const actionButton = event.target.closest("[data-action]");
  if (actionButton) handleRecordAction(actionButton);
});

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#sidebarBackdrop").classList.add("visible");
  $("#menuToggle").setAttribute("aria-expanded", "true");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#sidebarBackdrop").classList.remove("visible");
  $("#menuToggle").setAttribute("aria-expanded", "false");
}
$("#menuToggle").addEventListener("click", () =>
  $("#sidebar").classList.contains("open") ? closeSidebar() : openSidebar()
);
$("#sidebarBackdrop").addEventListener("click", closeSidebar);
$("#headerAvatar").addEventListener("click", () => goPage("settings"));
$("#editProfile").addEventListener("click", () => goPage("settings"));

/* DASHBOARD */
function setProgress(idName, percent) {
  const el = $("#" + idName);
  if (el) el.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function renderProfile() {
  const p = state.profile || {};
  $("#sidebarName").textContent = p.name || "Student";
  $("#sidebarClass").textContent = [p.className, p.board].filter(Boolean).join(" · ") || "My study space";
  $("#greeting").textContent = `Welcome back, ${p.name || "student"}.`;
  $("#heroGoal").textContent = p.goal || "Keep building your routine";
  $("#topbarDate").textContent = new Date().toLocaleDateString(undefined, { weekday:"short", day:"numeric", month:"short" });
  $("#welcomeDate").textContent = new Date().toLocaleDateString(undefined, { weekday:"long", month:"long", day:"numeric" }).toUpperCase();

  const avatarHTML = p.photo
    ? `<img src="${escapeAttr(p.photo)}" alt="Profile photo">`
    : escapeHTML((p.name || "S").charAt(0).toUpperCase());
  $("#sidebarAvatar").innerHTML = avatarHTML;
  $("#headerAvatar").innerHTML = avatarHTML;
  $("#settingsAvatar").innerHTML = avatarHTML;
}

function renderDashboard() {
  const tasks = state.records.tasks;
  const done = completedTasks();
  const chapters = state.records.syllabus;
  const focusToday = minutesForDay(todayKey());
  const streak = streakCount();

  $("#statFocus").innerHTML = `${focusToday} <small>min</small>`;
  $("#statTasks").innerHTML = `${done} <small>/ ${tasks.length}</small>`;
  $("#statChapters").textContent = chaptersDone();
  $("#statStreak").innerHTML = `${streak} <small>days</small>`;

  setProgress("focusProgress", focusToday / 120 * 100);
  setProgress("taskProgress", tasks.length ? done / tasks.length * 100 : 0);
  setProgress("chapterProgress", chapters.length ? chaptersDone() / chapters.length * 100 : 0);
  setProgress("streakProgress", streak / 7 * 100);

  const upcoming = tasks.filter(t => !t.completed).sort((a,b) =>
    (a.due || "9999").localeCompare(b.due || "9999")
  ).slice(0, 4);

  $("#dashboardUpcoming").innerHTML = upcoming.length
    ? upcoming.map(t => `
      <div class="list-item">
        <input class="item-check" type="checkbox" data-action="toggle-task" data-id="${escapeAttr(t.id)}" aria-label="Complete ${escapeAttr(t.title)}">
        <div class="list-item-main">
          <span class="list-item-title">${escapeHTML(t.title)}</span>
          <div class="list-item-meta">${escapeHTML(t.subject || "General")} · ${t.due ? formatDate(t.due) : "No due date"}</div>
        </div>
      </div>`).join("")
    : emptyState("No pending tasks", "Add a task when you're ready to plan your next priority.", "tasks", "Add a task");

  const upcomingExams = state.records.exams.filter(e => e.date && e.date >= todayKey())
    .sort((a,b) => a.date.localeCompare(b.date));
  const exam = upcomingExams[0];
  if (!exam) {
    $("#dashboardExam").innerHTML = `<strong>No upcoming exams</strong><p class="muted">Add an exam to see your countdown here.</p><button class="btn btn-secondary" data-add="exams">＋ Add exam</button>`;
  } else {
    const days = Math.ceil((parseDate(exam.date) - parseDate(todayKey())) / 86400000);
    $("#dashboardExam").innerHTML = `
      <span class="eyebrow">NEXT ON YOUR CALENDAR</span>
      <h3>${escapeHTML(exam.title)}</h3>
      <p class="muted">${escapeHTML(exam.subject || "Exam")} · ${formatDate(exam.date)}</p>
      <div class="exam-countdown">${days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}</div>
      <span class="muted">until your exam</span>`;
  }

  renderWeeklyChart();
}

function emptyState(title, message, page, actionLabel = "Open") {
  return `<div class="empty-state"><div class="empty-symbol">✦</div><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p>${page ? `<button class="btn btn-secondary" data-page="${escapeAttr(page)}">${escapeHTML(actionLabel)}</button>` : ""}</div>`;
}

function weeklyData() {
  const labels = [];
  const values = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    labels.push(d.toLocaleDateString(undefined, { weekday:"short" }));
    values.push(minutesForDay(dateKey(d)));
  }
  return { labels, values };
}

function chartOptions() {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#9eada9" }, border: { display: false } },
      y: { beginAtZero: true, grid: { color: "#28332f" }, ticks: { color: "#9eada9", precision: 0 }, border: { display: false } }
    }
  };
}

function renderChart(canvasId, key) {
  if (!window.Chart) return;
  const canvas = $("#" + canvasId);
  if (!canvas) return;
  if (charts[key]) charts[key].destroy();
  const data = weeklyData();
  charts[key] = new Chart(canvas, {
    type: "bar",
    data: {
      labels: data.labels,
      datasets: [{
        data: data.values,
        backgroundColor: data.labels.map((_, i) => i === 6 ? "#a8f0c6" : "#496d59"),
        borderRadius: 7,
        maxBarThickness: 30
      }]
    },
    options: chartOptions()
  });
}

function renderWeeklyChart() {
  renderChart("weeklyChart", "weekly");
}

/* GENERAL RECORDS */
function getRecords(type) {
  return state.records[type] || [];
}

function recordActions(type, item) {
  const actions = [];
  if (type === "tasks") {
    actions.push(`<button class="small-action" data-action="toggle-task" data-id="${escapeAttr(item.id)}">${item.completed ? "Reopen" : "Complete"}</button>`);
  }
  if (type === "syllabus") {
    actions.push(`<button class="small-action" data-action="cycle-chapter" data-id="${escapeAttr(item.id)}">${item.status === "Completed" ? "Reopen" : "Update progress"}</button>`);
  }
  if (type === "goals") {
    actions.push(`<button class="small-action" data-action="goal-progress" data-id="${escapeAttr(item.id)}">${item.completed ? "Reopen" : "Mark done"}</button>`);
  }
  actions.push(`<button class="small-action" data-action="edit" data-type="${type}" data-id="${escapeAttr(item.id)}">Edit</button>`);
  actions.push(`<button class="small-action danger" data-action="delete" data-type="${type}" data-id="${escapeAttr(item.id)}">Delete</button>`);
  return actions.join("");
}

function renderListItem(type, item, options = {}) {
  let meta = [];
  if (item.subject) meta.push(item.subject);
  if (item.due) meta.push("Due " + formatDate(item.due));
  if (item.date) meta.push(formatDate(item.date));
  if (item.day) meta.push(item.day);
  if (item.time) meta.push(item.time);
  if (item.duration) meta.push(item.duration + " min");
  if (item.priority) meta.push(item.priority + " priority");
  if (item.status) meta.push(item.status);

  return `<div class="list-item ${item.completed ? "completed" : ""}">
    ${type === "tasks" ? `<input class="item-check" type="checkbox" data-action="toggle-task" data-id="${escapeAttr(item.id)}" ${item.completed ? "checked" : ""} aria-label="Mark ${escapeAttr(item.title)} complete">` : ""}
    <div class="list-item-main">
      <span class="list-item-title">${escapeHTML(item.title || "Untitled")}</span>
      <div class="list-item-meta">${escapeHTML(meta.join(" · ") || "No additional details")}</div>
      ${item.description ? `<p class="muted">${escapeHTML(item.description).replace(/\n/g, "<br>")}</p>` : ""}
      ${type === "notes" && item.url ? `<p><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer" class="text-button">Open resource ↗</a></p>` : ""}
    </div>
    <div class="list-item-actions">${recordActions(type, item)}</div>
  </div>`;
}

function renderRecordCollection(type, containerId, options = {}) {
  const container = $("#" + containerId);
  if (!container) return;
  let items = getRecords(type).slice();

  if (type === "tasks") {
    const filter = $("#taskFilter")?.value || "all";
    if (filter === "open") items = items.filter(x => !x.completed);
    if (filter === "done") items = items.filter(x => x.completed);
    items.sort((a,b) => Number(a.completed) - Number(b.completed) ||
      (a.due || "9999").localeCompare(b.due || "9999"));
    $("#taskSummary").textContent = `${completedTasks()} of ${state.records.tasks.length} completed`;
  } else if (type === "exams" || type === "revision" || type === "reminders") {
    items.sort((a,b) => (a.date || "9999").localeCompare(b.date || "9999"));
  } else if (type === "timetable") {
    items.sort((a,b) => ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].indexOf(a.day) -
      ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].indexOf(b.day));
  }

  if (!items.length) {
    const labels = {
      tasks:["No tasks yet","Add your first assignment or study priority."],
      exams:["No exams added","Add exam dates to create your preparation timeline."],
      timetable:["Your timetable is empty","Build a realistic weekly routine."],
      revision:["No revision sessions","Schedule a topic you want to revisit."],
      notes:["Your library is ready","Save your first note or learning resource."],
      reminders:["No reminders saved","Add a reminder for an important date."],
      syllabus:["No chapters yet","Add chapters to track syllabus progress."]
    };
    const pair = labels[type] || ["Nothing here yet","Add your first item."];
    container.innerHTML = emptyState(pair[0], pair[1], null);
    return;
  }

  if (type === "exams" || type === "notes") {
    container.innerHTML = items.map(item => `
      <article class="data-card">
        <div class="card-top"><span class="tag">${escapeHTML(item.subject || MODULES[type].title)}</span>
          ${type === "exams" ? `<span class="muted">${item.date ? formatDate(item.date) : "No date"}</span>` : ""}
        </div>
        <h3>${escapeHTML(item.title)}</h3>
        <p>${escapeHTML(item.description || (type === "exams" ? "Plan your preparation for this exam." : "No note content added yet."))}</p>
        ${type === "exams" && item.date ? `<div class="tag">${examLabel(item.date)}</div>` : ""}
        ${type === "notes" && item.url ? `<p><a class="text-button" href="${escapeAttr(item.url)}" target="_blank" rel="noopener noreferrer">Open resource ↗</a></p>` : ""}
        <div class="card-actions">${recordActions(type,item)}</div>
      </article>`).join("");
  } else if (type === "syllabus") {
    container.innerHTML = items.map(item => {
      const progress = item.status === "Completed" ? 100 : item.status === "In progress" ? 50 : 0;
      return `<article class="data-card">
        <div class="card-top"><span class="tag">${escapeHTML(item.subject)}</span><span class="muted">${progress}%</span></div>
        <h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.status || "Not started")}</p>
        <div class="inline-progress"><span style="width:${progress}%"></span></div>
        <div class="card-actions">${recordActions(type,item)}</div>
      </article>`;
    }).join("");
  } else if (type === "goals") {
    container.innerHTML = items.map(item => `
      <article class="data-card">
        <div class="card-top"><span class="tag">${item.completed ? "Completed" : "In progress"}</span><span class="muted">${item.due ? formatDate(item.due) : "No deadline"}</span></div>
        <h3>${escapeHTML(item.title)}</h3><p>${escapeHTML(item.target || item.description || "Keep making progress.")}</p>
        <div class="card-actions">${recordActions(type,item)}</div>
      </article>`).join("");
  } else {
    container.innerHTML = items.map(item => renderListItem(type,item)).join("");
  }
}

function examLabel(date) {
  const d = parseDate(date);
  if (!d) return "Date not set";
  const diff = Math.ceil((d - parseDate(todayKey())) / 86400000);
  if (diff < 0) return "Past exam";
  if (diff === 0) return "Today";
  return `${diff} days remaining`;
}

function renderSyllabusOverview() {
  const items = state.records.syllabus;
  const total = items.length;
  const complete = chaptersDone();
  const progress = total ? Math.round(complete / total * 100) : 0;
  $("#syllabusOverview").innerHTML = `
    <article class="stat-card"><span class="stat-label">Total chapters</span><strong class="stat-number">${total}</strong><div class="stat-foot">Across all subjects</div></article>
    <article class="stat-card"><span class="stat-label">Completed</span><strong class="stat-number">${complete}</strong><div class="stat-foot">Chapters marked complete</div></article>
    <article class="stat-card"><span class="stat-label">Overall progress</span><strong class="stat-number">${progress}%</strong><div class="mini-progress"><span style="width:${progress}%"></span></div></article>`;
}

function renderTimetable() {
  const container = $("#timetableList");
  const items = state.records.timetable;
  if (!items.length) {
    container.innerHTML = emptyState("No study blocks yet","Add a session for any day of the week.");
    return;
  }
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  container.innerHTML = days.map(day => {
    const dayItems = items.filter(x => x.day === day).sort((a,b) => (a.time || "").localeCompare(b.time || ""));
    if (!dayItems.length) return "";
    return `<div><h3>${day}</h3><div class="list-stack">${dayItems.map(x => renderListItem("timetable",x)).join("")}</div></div>`;
  }).join("");
}

function renderAll() {
  renderProfile();
  renderDashboard();
  renderRecordCollection("tasks","tasksList");
  renderRecordCollection("exams","examsList");
  renderTimetable();
  renderSyllabusOverview();
  renderRecordCollection("syllabus","syllabusList");
  renderRecordCollection("revision","revisionList");
  renderRecordCollection("notes","notesList");
  renderRecordCollection("goals","goalsList");
  renderRecordCollection("reminders","remindersList");
  renderFocusHistory();
  renderSettings();
  renderSubscription();
}

/* CREATE / EDIT FORMS */
function openItemDialog(type, item = null) {
  if (!MODULES[type]) return;
  dialogType = type;
  editingId = item?.id || null;
  const schema = MODULES[type];
  $("#dialogTitle").textContent = `${item ? "Edit" : "Add"} ${schema.title.toLowerCase()}`;

  $("#dialogFields").innerHTML = schema.fields.map(([key,label,kind,required,options]) => {
    const value = item?.[key] ?? (key === "priority" ? "Normal" : key === "status" ? "Not started" : key === "duration" ? 45 : "");
    const common = `name="${key}" id="field-${key}" ${required ? "required" : ""}`;
    if (kind === "select") {
      return `<label>${label}<select ${common}>${options.map(opt =>
        `<option value="${escapeAttr(opt)}" ${String(value) === opt ? "selected" : ""}>${escapeHTML(opt)}</option>`
      ).join("")}</select></label>`;
    }
    if (kind === "textarea") {
      return `<label>${label}<textarea ${common} maxlength="12000" placeholder="${escapeAttr(label)}">${escapeHTML(value)}</textarea></label>`;
    }
    const typeAttr = ["date","time","number","url"].includes(kind) ? kind : "text";
    return `<label>${label}<input ${common} type="${typeAttr}" value="${escapeAttr(value)}" ${kind === "number" ? 'min="1" max="1440"' : ""} ${kind === "url" ? 'maxlength="1000" placeholder="https://..."' : ""} ${kind === "text" ? 'maxlength="180" placeholder="Enter '+escapeAttr(label.toLowerCase())+'"' : ""}></label>`;
  }).join("");

  const dialog = $("#itemDialog");
  if (!dialog.open) dialog.showModal();
}

function closeItemDialog() {
  $("#itemDialog").close();
  dialogType = null;
  editingId = null;
}
$("#closeDialog").addEventListener("click", closeItemDialog);
$("#cancelDialog").addEventListener("click", closeItemDialog);

$("#itemForm").addEventListener("submit", event => {
  event.preventDefault();
  if (!dialogType) return;

  const schema = MODULES[dialogType];
  const data = {};
  for (const [key] of schema.fields) {
    const input = $(`[name="${key}"]`, $("#dialogFields"));
    data[key] = input ? input.value.trim() : "";
  }

  if (data.url) {
    try {
      const parsed = new URL(data.url);
      if (!["http:","https:"].includes(parsed.protocol)) throw new Error();
    } catch {
      toast("Please enter a valid http or https resource link.", true);
      return;
    }
  }

  if (dialogType === "tasks") data.completed = false;
  if (dialogType === "goals") data.completed = false;
  if (dialogType === "syllabus" && !data.status) data.status = "Not started";

  const list = state.records[dialogType];
  if (editingId) {
    const index = list.findIndex(x => x.id === editingId);
    if (index !== -1) list[index] = { ...list[index], ...data };
    toast(`${schema.title} updated.`);
  } else {
    list.push({ id: id(), createdAt: new Date().toISOString(), ...data });
    toast(`${schema.title} saved.`);
  }

  markActiveDay();
  if (!saveState()) return;
  closeItemDialog();
  renderAll();
  if (dialogType === "tasks") goPage("tasks");
});

/* RECORD ACTIONS */
function handleRecordAction(button) {
  const action = button.dataset.action;
  const recordId = button.dataset.id;

  if (action === "toggle-task") {
    const task = state.records.tasks.find(x => x.id === recordId);
    if (!task) return;
    task.completed = button.checked !== undefined ? button.checked : !task.completed;
    if (task.completed) markActiveDay();
    saveState(); renderAll();
    return;
  }

  if (action === "cycle-chapter") {
    const item = state.records.syllabus.find(x => x.id === recordId);
    if (!item) return;
    item.status = item.status === "Not started" ? "In progress" :
      item.status === "In progress" ? "Completed" : "Not started";
    if (item.status === "Completed") markActiveDay();
    saveState(); renderAll();
    return;
  }

  if (action === "goal-progress") {
    const item = state.records.goals.find(x => x.id === recordId);
    if (!item) return;
    item.completed = !item.completed;
    if (item.completed) markActiveDay();
    saveState(); renderAll();
    return;
  }

  const type = button.dataset.type;
  if (!MODULES[type]) return;
  const item = state.records[type].find(x => x.id === recordId);
  if (!item) return;

  if (action === "edit") {
    openItemDialog(type,item);
  } else if (action === "delete") {
    askConfirm(`Delete ${MODULES[type].title.toLowerCase()}?`,
      `This will remove "${item.title}" from your local planner.`, () => {
        state.records[type] = state.records[type].filter(x => x.id !== recordId);
        saveState(); renderAll(); toast("Item deleted.");
      });
  }
}

$("#taskFilter").addEventListener("change", () => renderRecordCollection("tasks","tasksList"));

/* FOCUS TIMER */
function updateFocusClock() {
  const mins = Math.floor(focusRemaining / 60);
  const secs = focusRemaining % 60;
  $("#focusClock").textContent = `${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  $("#focusTimerBar").style.width = `${Math.max(0, focusRemaining / (focusMinutes * 60) * 100)}%`;
  $("#focusStart").textContent = focusRunning ? "Pause focus" : "Start focus";
  $("#focusModeLabel").textContent = focusRunning ? "You're in a focus session" : "Ready when you are";
  $$("[data-minutes]").forEach(button => button.classList.toggle("selected", Number(button.dataset.minutes) === focusMinutes));
}

function stopFocusInterval() {
  if (focusInterval) clearInterval(focusInterval);
  focusInterval = null;
}

function startFocusInterval() {
  stopFocusInterval();
  focusRunning = true;
  focusEndTime = Date.now() + focusRemaining * 1000;
  focusInterval = setInterval(() => {
    focusRemaining = Math.max(0, Math.ceil((focusEndTime - Date.now()) / 1000));
    updateFocusClock();
    if (focusRemaining <= 0) finishFocus();
  }, 250);
  updateFocusClock();
}

function finishFocus() {
  stopFocusInterval();
  focusRunning = false;
  const minutes = focusMinutes;
  const subject = safeText($("#focusSubject").value,"General study");
  state.sessions.push({ id:id(), date:todayKey(), minutes, subject, completedAt:new Date().toISOString() });
  state.sessions = state.sessions.slice(-1000);
  markActiveDay();
  saveState();
  focusRemaining = focusMinutes * 60;
  updateFocusClock();
  renderAll();
  toast(`Focus session complete! ${minutes} minutes recorded.`);
}

$("#focusStart").addEventListener("click", () => {
  if (focusRunning) {
    focusRemaining = Math.max(0, Math.ceil((focusEndTime - Date.now()) / 1000));
    stopFocusInterval();
    focusRunning = false;
    updateFocusClock();
  } else {
    startFocusInterval();
  }
});

$("#focusReset").addEventListener("click", () => {
  stopFocusInterval();
  focusRunning = false;
  focusRemaining = focusMinutes * 60;
  updateFocusClock();
});

$$("[data-minutes]").forEach(button => button.addEventListener("click", () => {
  if (focusRunning) {
    toast("Pause the current session before changing its duration.", true);
    return;
  }
  focusMinutes = Number(button.dataset.minutes);
  focusRemaining = focusMinutes * 60;
  updateFocusClock();
}));

function renderFocusHistory() {
  const container = $("#focusHistory");
  if (!container) return;
  const recent = [...state.sessions].reverse().slice(0, 8);
  container.innerHTML = recent.length
    ? recent.map(s => `<div class="list-item"><div class="list-item-main"><span class="list-item-title">${escapeHTML(s.subject || "Study session")}</span><div class="list-item-meta">${formatDate(s.date)} · ${Number(s.minutes) || 0} minutes</div></div></div>`).join("")
    : emptyState("Your first session starts here","Complete a focus session to see your history.");
}
updateFocusClock();

/* CALENDAR */
function eventItemsForDay(day) {
  return [
    ...state.records.tasks.filter(x => x.due === day).map(x => ({ ...x, kind:"Task" })),
    ...state.records.exams.filter(x => x.date === day).map(x => ({ ...x, kind:"Exam" })),
    ...state.records.revision.filter(x => x.date === day).map(x => ({ ...x, kind:"Revision" })),
    ...state.records.reminders.filter(x => x.date === day).map(x => ({ ...x, kind:"Reminder" }))
  ];
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  $("#calendarMonth").textContent = calendarDate.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const first = new Date(year,month,1);
  const startDay = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year,month+1,0).getDate();
  const previousDays = new Date(year,month,0).getDate();
  const weekdays = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  let html = weekdays.map(d => `<div class="calendar-weekday">${d}</div>`).join("");

  for (let i=0;i<42;i++) {
    let date, inMonth = true;
    if (i < startDay) {
      date = new Date(year,month-1,previousDays-startDay+i+1); inMonth = false;
    } else if (i >= startDay + daysInMonth) {
      date = new Date(year,month+1,i-startDay-daysInMonth+1); inMonth = false;
    } else {
      date = new Date(year,month,i-startDay+1);
    }
    const key = dateKey(date);
    const events = eventItemsForDay(key);
    const classes = ["calendar-day"];
    if (!inMonth) classes.push("muted-day");
    if (key === todayKey()) classes.push("today");
    if (key === selectedDate) classes.push("selected");
    html += `<button class="${classes.join(" ")}" data-calendar-day="${key}" aria-label="${escapeAttr(key)}, ${events.length} events">
      <span>${date.getDate()}</span>
      <span class="calendar-dots">${events.slice(0,3).map(e => `<i class="${e.kind === "Exam" ? "exam-dot" : ""}"></i>`).join("")}</span>
    </button>`;
  }
  $("#calendarGrid").innerHTML = html;
  renderCalendarEvents();
}

function renderCalendarEvents() {
  const events = eventItemsForDay(selectedDate);
  $("#calendarEvents").innerHTML = events.length
    ? events.map(e => `<div class="list-item"><div class="list-item-main"><span class="tag">${escapeHTML(e.kind)}</span><span class="list-item-title">${escapeHTML(e.title)}</span><div class="list-item-meta">${escapeHTML(e.subject || e.description || "")}</div></div></div>`).join("")
    : `<p class="muted">No scheduled items for ${formatDate(selectedDate)}.</p>`;
}

$("#calendarGrid").addEventListener("click", event => {
  const button = event.target.closest("[data-calendar-day]");
  if (!button) return;
  selectedDate = button.dataset.calendarDay;
  calendarDate = parseDate(selectedDate) || new Date();
  renderCalendar();
});
$("#calendarPrev").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(),calendarDate.getMonth()-1,1);
  renderCalendar();
});
$("#calendarNext").addEventListener("click", () => {
  calendarDate = new Date(calendarDate.getFullYear(),calendarDate.getMonth()+1,1);
  renderCalendar();
});

/* ANALYTICS */
function renderAnalytics() {
  const tasks = state.records.tasks.length;
  const done = completedTasks();
  const chapters = state.records.syllabus.length;
  const complete = chaptersDone();
  const hours = (totalMinutes()/60).toFixed(1);
  const cards = [
    ["Total study time",`${hours} h`,"Across saved sessions"],
    ["Tasks completed",`${done}/${tasks}`,tasks ? `${Math.round(done/tasks*100)}% completion` : "No tasks added yet"],
    ["Syllabus progress",`${chapters ? Math.round(complete/chapters*100) : 0}%`,`${complete} of ${chapters} chapters`],
    ["Study streak",`${streakCount()} days`,"Consecutive active days"]
  ];
  $("#analyticsStats").innerHTML = cards.map(([label,value,detail]) =>
    `<article class="stat-card"><span class="stat-label">${escapeHTML(label)}</span><strong class="stat-number">${escapeHTML(value)}</strong><div class="stat-foot">${escapeHTML(detail)}</div></article>`
  ).join("");

  renderChart("analyticsChart","analytics");
  const data = weeklyData();
  const best = Math.max(0,...data.values);
  const average = Math.round(data.values.reduce((a,b)=>a+b,0)/7);
  $("#analyticsSummary").innerHTML = `
    <div class="list-item"><div class="list-item-main"><span class="list-item-title">Daily average this week</span><div class="list-item-meta">${average} minutes</div></div></div>
    <div class="list-item"><div class="list-item-main"><span class="list-item-title">Most focused day this week</span><div class="list-item-meta">${best} minutes</div></div></div>
    <div class="list-item"><div class="list-item-main"><span class="list-item-title">Upcoming exams</span><div class="list-item-meta">${state.records.exams.filter(e => e.date >= todayKey()).length} saved</div></div></div>`;
}

/* PROFILE / PHOTO */
function renderSettings() {
  const p = state.profile || {};
  $("#settingsName").textContent = p.name || "Student";
  $("#settingsDetails").textContent = [p.className,p.board,p.goal].filter(Boolean).join(" · ");
  $("#settingsNameInput").value = p.name || "";
  $("#settingsAgeInput").value = p.age || "";
  $("#settingsClassInput").value = p.className || "";
  $("#settingsBoardInput").value = p.board || "ICSE";
  $("#settingsGoalInput").value = p.goal || "Improve my grades";
}

$("#settingsForm").addEventListener("submit", event => {
  event.preventDefault();
  const name = $("#settingsNameInput").value.trim();
  const age = Number($("#settingsAgeInput").value);
  const className = $("#settingsClassInput").value.trim();
  if (!name || !className || age < 5 || age > 100) {
    toast("Please enter a valid name, age and class.", true);
    return;
  }
  state.profile = {
    ...state.profile,
    name, age, className,
    board: $("#settingsBoardInput").value,
    goal: $("#settingsGoalInput").value
  };
  if (saveState()) {
    renderAll();
    toast("Profile updated.");
  }
});

$("#photoUpload").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    toast("Choose an image file.", true);
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast("Please choose an image smaller than 8 MB.", true);
    return;
  }

  const reader = new FileReader();
  reader.onerror = () => toast("Could not read that image.", true);
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => toast("That image could not be opened.", true);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const maxSide = 360;
      const scale = Math.min(1,maxSide / Math.max(img.width,img.height));
      canvas.width = Math.max(1,Math.round(img.width*scale));
      canvas.height = Math.max(1,Math.round(img.height*scale));
      canvas.getContext("2d").drawImage(img,0,0,canvas.width,canvas.height);
      state.profile.photo = canvas.toDataURL("image/jpeg",0.78);
      if (saveState()) {
        renderProfile(); renderSettings();
        toast("Profile photo updated.");
      }
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
  event.target.value = "";
});

/* MEMBERSHIP DEMO */
function renderSubscription() {
  const plan = state.plan || "Free";
  $("#currentPlan").innerHTML = `<strong>${escapeHTML(plan)} membership</strong><p>${plan === "Free" ? "You are using the free STUDYX plan. You can change plans at any time in this demo." : "This is a local demo selection, not a verified paid subscription."}</p>`;
  $$("[data-plan]").forEach(button => {
    const isCurrent = button.dataset.plan === plan;
    button.textContent = isCurrent ? `Current ${plan} plan` : `Select ${button.dataset.plan}`;
    button.disabled = isCurrent;
  });
}
$$("[data-plan]").forEach(button => button.addEventListener("click", () => {
  const plan = button.dataset.plan;
  if (plan === "Free") {
    state.plan = "Free";
    saveState(); renderSubscription();
    toast("Free plan selected.");
    return;
  }
  askConfirm(`Explore ${plan}?`,
    `This demo will mark ${plan} as your selected plan. No payment will be taken and premium purchases are not verified.`, () => {
      state.plan = plan;
      saveState(); renderSubscription();
      toast(`${plan} demo plan selected.`);
    });
}));

/* REMINDERS */
$("#enableNotifications").addEventListener("click", async () => {
  if (!("Notification" in window)) {
    toast("Notifications are not supported by this browser.", true);
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    state.preferences.notifications = permission === "granted";
    saveState();
    toast(permission === "granted" ? "Browser notifications enabled." : "Notification permission was not granted.", permission !== "granted");
  } catch {
    toast("Could not request notification permission.", true);
  }
});

function checkReminders() {
  if (!state.preferences.notifications || !("Notification" in window) || Notification.permission !== "granted") return;
  const now = new Date();
  const stamp = `${dateKey(now)} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  if (stamp === lastReminderCheck) return;
  lastReminderCheck = stamp;
  state.records.reminders.forEach(reminder => {
    if (reminder.date !== dateKey(now)) return;
    if (reminder.time && reminder.time !== stamp.slice(11)) return;
    const key = `${reminder.id}:${stamp}`;
    if (sessionStorage.getItem(key)) return;
    try {
      new Notification("STUDYX reminder", { body: reminder.title });
      sessionStorage.setItem(key,"1");
    } catch {}
  });
}

/* EXPORT / IMPORT */
function downloadJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

function exportData() {
  downloadJSON(`studyx-backup-${todayKey()}.json`, {
    app:"STUDYX", version:1, exportedAt:new Date().toISOString(), state
  });
  toast("Backup export started.");
}

$("#exportData").addEventListener("click",exportData);
$("#exportAnalytics").addEventListener("click",exportData);
$("#importDataButton").addEventListener("click",() => $("#importData").click());

$("#importData").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed.state || parsed;
    if (!incoming || !incoming.records || !incoming.profile) throw new Error("Invalid backup format");
    askConfirm("Import this backup?","Your current local STUDYX data will be replaced by the imported backup.",() => {
      const base = DEFAULT_STATE();
      state = {
        ...base, ...incoming,
        records:{...base.records,...incoming.records},
        sessions:Array.isArray(incoming.sessions)?incoming.sessions:[],
        activeDays:Array.isArray(incoming.activeDays)?incoming.activeDays:[],
        preferences:{...base.preferences,...(incoming.preferences||{})}
      };
      if (saveState()) {
        renderAll();
        toast("Backup imported.");
      }
    });
  } catch {
    toast("This file is not a valid STUDYX backup.",true);
  }
  event.target.value = "";
});

/* CONFIRMATION DIALOG */
function askConfirm(title,message,callback) {
  confirmAction = callback;
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  $("#confirmDialog").showModal();
}
function closeConfirm() {
  $("#confirmDialog").close();
  confirmAction = null;
}
$("#confirmCancel").addEventListener("click",closeConfirm);
$("#confirmYes").addEventListener("click",() => {
  const action = confirmAction;
  closeConfirm();
  if (action) action();
});

$("#deleteAccount").addEventListener("click",() => {
  askConfirm("Delete all local STUDYX data?",
    "This permanently deletes the profile, photo, tasks, exams, notes, focus history and settings stored by this website in this browser. Export a backup first if you want to keep your information.",() => {
      stopFocusInterval();
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      state = DEFAULT_STATE();
      toast("Local data deleted.");
      $("#app").hidden = true;
      $("#onboarding").hidden = false;
      $("#profileForm").reset();
      showOnboardingStep(0);
    });
});

/* DIALOG SAFETY: close on backdrop click */
["itemDialog","confirmDialog"].forEach(dialogId => {
  const dialog = $("#" + dialogId);
  dialog.addEventListener("click",event => {
    if (event.target === dialog) dialog.close();
  });
});

/* START */
markActiveDay();
saveState();
startApp();
updateFocusClock();
reminderCheckInterval = setInterval(checkReminders,15000);
