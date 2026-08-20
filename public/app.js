const socket = io();
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
let state = {
  tool: "pen",
  color: "#172033",
  width: 4,
  room: "",
  student: null,
  history: [],
  drawing: false,
  start: null,
  parts: 4,
  numberType: "fraction",
  numberStart: 0,
  numberEnd: 1,
  equations: [],
  quiz: null,
};
let wordTimerHandle = null;
const canvas = $("#canvas"),
  ctx = canvas.getContext("2d"),
  box = $("#canvasBox");
function go(id) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  $("#" + id).classList.add("active");
}
$$("[data-go]").forEach((b) => (b.onclick = () => go(b.dataset.go)));
function toast(t) {
  const e = $("#toast");
  e.textContent = t;
  e.classList.add("show");
  setTimeout(() => e.classList.remove("show"), 1800);
}
function resize() {
  if (!$("#student").classList.contains("active")) return;
  const dpr = devicePixelRatio || 1,
    r = box.getBoundingClientRect(),
    old = canvas.toDataURL();
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const im = new Image();
  im.onload = () => ctx.drawImage(im, 0, 0, r.width, r.height);
  im.src = old;
}
function snapshot() {
  state.history.push({
    image: canvas.toDataURL(),
    equations: $("#equationLayer").innerHTML,
  });
  if (state.history.length > 30) state.history.shift();
}
function restore(s) {
  const im = new Image();
  im.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(im, 0, 0, box.clientWidth, box.clientHeight);
  };
  im.src = s.image;
  $("#equationLayer").innerHTML = s.equations;
  $$(".text-item").forEach(bindTextItem);
}
function broadcast() {
  if (!state.student) return;
  socket.emit("drawing", {
    student: state.student,
    image: canvas.toDataURL(),
    equations: state.equations,
    at: Date.now(),
  });
}
$("#enterStudent").onclick = () => {
  const room = $("#roomInput").value.trim().toUpperCase(),
    number = $("#numberInput").value,
    name = $("#nameInput").value.trim();
  if (!room || !number || !name)
    return toast("수업 코드, 번호, 이름을 모두 입력해 주세요");
  state.room = room;
  state.student = { number, name };
  socket.emit("join", { room, student: state.student });
  $("#roomBadge").textContent = `● ${room} 연결됨`;
  $("#roomBadge").classList.remove("hidden");
  $("#studentLabel").textContent = `${number}번 ${name}`;
  go("student");
  box.className = "grid";
  setTimeout(() => {
    resize();
    snapshot();
  }, 30);
};
$$(".tool[data-tool]").forEach(
  (b) =>
    (b.onclick = () => {
      if (b.dataset.tool === "equation") {
        state.tool = "equation";
        $("#mathDialog").classList.remove("hidden");
        $("#mathInput").focus();
        return;
      }
      if (b.dataset.tool === "text") {
        state.tool = "text";
        $("#textDialog").classList.remove("hidden");
        $("#textInput").focus();
        return;
      }
      if (b.dataset.tool === "number") {
        $("#numberDialog").classList.remove("hidden");
        return;
      }
      state.tool = b.dataset.tool;
      $("#equationLayer").classList.toggle(
        "select-mode",
        state.tool === "select",
      );
      $$(".tool").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    }),
);
$$(".color").forEach(
  (b) =>
    (b.onclick = () => {
      state.color = b.dataset.color;
      $$(".color").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    }),
);
$("#width").oninput = (e) => (state.width = +e.target.value);
$("#paper").onchange = (e) => (box.className = e.target.value);
function pos(e) {
  const r = canvas.getBoundingClientRect(),
    p = e.touches?.[0] || e;
  return { x: p.clientX - r.left, y: p.clientY - r.top };
}
canvas.onpointerdown = (e) => {
  if (["equation", "text", "select"].includes(state.tool)) return;
  snapshot();
  state.drawing = true;
  state.start = pos(e);
  ctx.beginPath();
  ctx.moveTo(state.start.x, state.start.y);
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!state.drawing) return;
  const p = pos(e);
  if (state.tool === "pen" || state.tool === "eraser") {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = state.tool === "eraser" ? "#fff" : state.color;
    ctx.lineWidth = state.tool === "eraser" ? state.width * 5 : state.width;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
};
canvas.onpointerup = (e) => {
  if (!state.drawing) return;
  const p = pos(e);
  if (state.tool === "line") drawLine(state.start, p);
  if (state.tool === "number") drawNumberLine(state.start, p, state.parts);
  state.drawing = false;
  broadcast();
};
function drawLine(a, b) {
  ctx.strokeStyle = state.color;
  ctx.lineWidth = state.width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}
function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return Math.abs(a) || 1;
}
function numberLabel(i, n) {
  if (state.numberType === "natural") return String(state.numberStart + i);
  const value =
    state.numberStart + ((state.numberEnd - state.numberStart) * i) / n;
  if (state.numberType === "decimal")
    return String(Math.round(value * 100) / 100);
  if (state.numberType === "integer") return String(Math.round(value));
  if (state.numberStart === 0 && state.numberEnd === 1) {
    if (i === 0) return "0";
    if (i === n) return "1";
    const g = gcd(i, n);
    return `${i / g}/${n / g}`;
  }
  return String(Math.round(value * 100) / 100);
}
function drawNumberLine(a, b, n) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 30) return;
  drawLine(a, b);
  const dx = (b.x - a.x) / n,
    dy = (b.y - a.y) / n,
    nx = -(b.y - a.y) / len,
    ny = (b.x - a.x) / len;
  ctx.font = "13px Noto Sans KR";
  ctx.fillStyle = state.color;
  ctx.textAlign = "center";
  for (let i = 0; i <= n; i++) {
    const x = a.x + dx * i,
      y = a.y + dy * i;
    ctx.beginPath();
    ctx.moveTo(x - nx * 7, y - ny * 7);
    ctx.lineTo(x + nx * 7, y + ny * 7);
    ctx.stroke();
    ctx.fillText(numberLabel(i, n), x + nx * 22, y + ny * 22 + 5);
  }
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(
    b.x - ((b.x - a.x) / len) * 13 + nx * 7,
    b.y - ((b.y - a.y) / len) * 13 + ny * 7,
  );
  ctx.lineTo(
    b.x - ((b.x - a.x) / len) * 13 - nx * 7,
    b.y - ((b.y - a.y) / len) * 13 - ny * 7,
  );
  ctx.closePath();
  ctx.fill();
}
$("#numberReady").onclick = () => {
  state.parts = Math.max(2, Math.min(24, +$("#partsInput").value || 4));
  state.numberType = $("#numberType").value;
  state.numberStart = +$("#numberStart").value || 0;
  state.numberEnd = +$("#numberEnd").value;
  if (state.numberType === "natural") {
    state.numberStart = Math.max(1, Math.round(state.numberStart) || 1);
    state.numberEnd = state.numberStart + state.parts;
  }
  if (
    !Number.isFinite(state.numberEnd) ||
    state.numberEnd === state.numberStart
  )
    return toast("시작 값과 다른 끝 값을 입력해 주세요");
  state.tool = "number";
  $$(".tool").forEach((x) => x.classList.remove("active"));
  $('[data-tool="number"]').classList.add("active");
  $("#numberDialog").classList.add("hidden");
  toast(`${state.parts}칸 수직선: 캔버스에서 드래그하세요`);
};
$("#textCancel").onclick = () => $("#textDialog").classList.add("hidden");
function bindTextItem(el) {
  el.onpointerdown = (e) => {
    if (state.tool !== "select") return;
    e.preventDefault();
    snapshot();
    const layerRect = $("#equationLayer").getBoundingClientRect();
    const itemRect = el.getBoundingClientRect();
    const offsetX = e.clientX - itemRect.left;
    const offsetY = e.clientY - itemRect.top;
    el.setPointerCapture(e.pointerId);
    el.onpointermove = (move) => {
      const maxX = layerRect.width - el.offsetWidth;
      const maxY = layerRect.height - el.offsetHeight;
      el.style.left = `${Math.max(0, Math.min(maxX, move.clientX - layerRect.left - offsetX))}px`;
      el.style.top = `${Math.max(0, Math.min(maxY, move.clientY - layerRect.top - offsetY))}px`;
    };
    el.onpointerup = () => {
      el.onpointermove = null;
      el.onpointerup = null;
      broadcast();
    };
  };
}
$("#textAdd").onclick = () => {
  const text = $("#textInput").value.trim();
  if (!text) return;
  const el = document.createElement("div");
  el.className = "text-item";
  el.textContent = text;
  el.style.color = state.color;
  el.style.fontSize = `${Math.max(14, Math.min(72, +$("#textSize").value || 28))}px`;
  el.style.left = "12%";
  el.style.top = `${12 + $("#equationLayer").children.length * 9}%`;
  bindTextItem(el);
  $("#equationLayer").append(el);
  $("#textDialog").classList.add("hidden");
  $("#textInput").value = "";
  broadcast();
  toast("텍스트를 추가했어요");
};
$("#mathInput").oninput = (e) => {
  try {
    katex.render(e.target.value, $("#mathPreview"), { throwOnError: false });
  } catch {}
};
$("#mathCancel").onclick = () => $("#mathDialog").classList.add("hidden");
$("#mathAdd").onclick = () => {
  const latex = $("#mathInput").value.trim();
  if (!latex) return;
  const el = document.createElement("div");
  el.className = "equation";
  el.style.left = "12%";
  el.style.top = `${12 + state.equations.length * 10}%`;
  katex.render(latex, el, { throwOnError: false });
  $("#equationLayer").append(el);
  state.equations.push(latex);
  $("#mathDialog").classList.add("hidden");
  $("#mathInput").value = "";
  $("#mathPreview").textContent = "식을 입력하세요";
  broadcast();
  toast("수식을 추가했어요");
};
$("#undo").onclick = () => {
  if (state.history.length > 1) {
    state.history.pop();
    restore(state.history[state.history.length - 1]);
    broadcast();
  }
};
$("#clear").onclick = () => {
  snapshot();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("#equationLayer").innerHTML = "";
  state.equations = [];
  broadcast();
};
$("#watchRoom").onclick = () => {
  const room = $("#teacherRoom").value.trim().toUpperCase();
  if (!room) return;
  state.room = room;
  socket.emit("join", { room });
  socket.emit("request-snapshots", room);
  $("#roomBadge").textContent = `● ${room} 모니터링 중`;
  $("#roomBadge").classList.remove("hidden");
  $("#studentGrid").innerHTML = "";
  toast("실시간 모니터링을 시작합니다");
};
$("#prepareQuiz").onclick = () => {
  if (!state.room) return toast("먼저 수업 코드를 열어 주세요");
  socket.emit("quiz-prepare", state.room);
  $("#quizForm").classList.remove("hidden");
  $("#teacherQuestion").focus();
  toast("학생 화면을 준비 중으로 바꿨어요");
};
$("#publishQuiz").onclick = () => {
  const question = $("#teacherQuestion").value.trim(),
    answer = $("#teacherAnswer").value.trim(),
    explanation = $("#teacherExplanation").value.trim();
  if (!question || !answer) return toast("문제와 정답을 입력해 주세요");
  socket.emit("quiz-publish", {
    room: state.room,
    question,
    answer,
    explanation,
  });
  toast("모든 학생에게 퀴즈를 출제했어요");
};
$("#endQuiz").onclick = () => {
  if (!state.room) return;
  socket.emit("quiz-end", state.room);
  $("#quizForm").classList.add("hidden");
  $("#quizResults").innerHTML = "";
  toast("퀴즈 모드를 종료했어요");
};
$$(".mode-tabs button").forEach(
  (b) =>
    (b.onclick = () => {
      $$(".mode-tabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      $$(".mode-panel").forEach((x) => x.classList.add("hidden"));
      $("#" + b.dataset.panel).classList.remove("hidden");
    }),
);
$("#startWordGame").onclick = () => {
  if (!state.room) return toast("먼저 수업 코드를 열어 주세요");
  const startWord = $("#startWord").value.trim(),
    timeLimit = +$("#wordTime").value;
  if (!/^[가-힣]{2,}$/.test(startWord))
    return toast("첫 단어는 두 글자 이상의 한글로 입력해 주세요");
  socket.emit("wordgame-start", { room: state.room, timeLimit, startWord });
  toast("끝말잇기를 시작했어요");
};
$("#endWordGame").onclick = () => {
  if (!state.room) return;
  socket.emit("wordgame-end", state.room);
  $("#teacherWordStatus").textContent = "게임을 종료했습니다.";
};
$("#clearRoom").onclick = () => {
  if (state.room && confirm("이 수업의 모든 학생 화면을 초기화할까요?"))
    socket.emit("clear-room", state.room);
};
socket.on("drawing", (p) => {
  if (!$("#teacher").classList.contains("active")) return;
  let card = $(`#student-${p.student.number}`);
  if (!card) {
    card = document.createElement("article");
    card.className = "student-card";
    card.id = `student-${p.student.number}`;
    card.innerHTML = `<header><b>${p.student.number}번 ${p.student.name}</b><span class="online">● 실시간</span></header><img alt="${p.student.name} 학생 풀이">`;
    $("#studentGrid").append(card);
  }
  card.querySelector("img").src = p.image;
});
socket.on("clear-room", () => {
  if ($("#student").classList.contains("active")) {
    $("#clear").click();
    toast("선생님이 캔버스를 초기화했어요");
  } else
    $("#studentGrid").innerHTML =
      '<div class="empty"><b>캔버스를 초기화했습니다</b><p>새 풀이를 기다리는 중입니다.</p></div>';
});
socket.on("quiz-state", (quiz) => {
  state.quiz = quiz;
  if (!state.student) return;
  const overlay = $("#quizOverlay");
  if (quiz.status === "ended") {
    overlay.classList.add("hidden");
    return;
  }
  overlay.classList.remove("hidden");
  if (quiz.status === "preparing") {
    $("#quizPreparing").classList.remove("hidden");
    $("#quizActive").classList.add("hidden");
    return;
  }
  $("#quizPreparing").classList.add("hidden");
  $("#quizActive").classList.remove("hidden");
  $("#quizQuestion").textContent = quiz.question;
  $("#quizAnswer").value = "";
  $("#quizFeedback").className = "";
  $("#quizFeedback").textContent = "";
});
$("#submitAnswer").onclick = () => {
  if (!state.quiz || state.quiz.status !== "active") return;
  const clean = (s) => s.trim().replace(/\s+/g, "").toLowerCase();
  const correct = clean($("#quizAnswer").value) === clean(state.quiz.answer);
  const feedback = $("#quizFeedback");
  feedback.className = correct ? "feedback-good" : "feedback-bad";
  feedback.innerHTML = correct
    ? "정답입니다! 정말 잘했어요 🎉"
    : `아쉬워요. 정답은 <b>${state.quiz.answer}</b>입니다.${state.quiz.explanation ? `<br><small>${state.quiz.explanation}</small>` : ""}`;
  socket.emit("quiz-result", {
    room: state.room,
    student: state.student,
    correct,
  });
};
socket.on("quiz-student-result", (r) => {
  if (!$("#teacher").classList.contains("active")) return;
  const line = document.createElement("span");
  line.className = r.correct ? "feedback-good" : "feedback-bad";
  line.textContent = `${r.student.number}번 ${r.student.name}: ${r.correct ? "정답" : "오답"}`;
  line.style.marginRight = "8px";
  line.style.padding = "5px 8px";
  $("#quizResults").append(line);
});
socket.on("wordgame-state", (game) => {
  if (game.status === "ended") {
    clearInterval(wordTimerHandle);
    $("#wordOverlay").classList.add("hidden");
    $("#teacherWordStatus").textContent = "게임이 종료되었습니다.";
    return;
  }
  if ($("#teacher").classList.contains("active"))
    $("#teacherWordStatus").textContent =
      `현재 단어: ${game.currentWord} · ${game.used.length}개 사용 · ${game.message}`;
  if (!state.student) return;
  $("#quizOverlay").classList.add("hidden");
  $("#wordOverlay").classList.remove("hidden");
  $("#currentWord").textContent = game.currentWord;
  $("#lastChar").textContent = game.currentWord.at(-1);
  $("#wordMessage").textContent = game.message;
  $("#usedWords").textContent = game.used.slice(-8).join(" → ");
  $("#wordFeedback").textContent = "";
  $("#wordInput").value = "";
  clearInterval(wordTimerHandle);
  const tick = () => {
    const left = Math.max(0, Math.ceil((game.deadline - Date.now()) / 1000));
    $("#wordTimer").textContent = left;
    $("#wordTimer").classList.toggle("urgent", left <= 5);
    if (left === 0)
      $("#wordFeedback").textContent =
        "시간이 초과됐어요. 다음 진행을 기다려 주세요.";
  };
  tick();
  wordTimerHandle = setInterval(tick, 250);
});
$("#submitWord").onclick = () => {
  const word = $("#wordInput").value.trim();
  if (!word) return;
  $("#wordFeedback").textContent = "표준국어대사전에서 확인 중…";
  socket.emit("wordgame-submit", {
    room: state.room,
    student: state.student,
    word,
  });
};
$("#wordInput").onkeydown = (e) => {
  if (e.key === "Enter") $("#submitWord").click();
};
socket.on("wordgame-reject", (message) => {
  $("#wordFeedback").textContent = message;
  $("#wordFeedback").className = "feedback-bad";
});
window.onresize = resize;
