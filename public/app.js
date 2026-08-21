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
let modalStudentNumber = null;
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
    broadcast();
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
const moveLayer = $("#equationLayer");
let activeDrag = null;
function beginMove(e) {
  if (state.tool !== "select") return;
  const item = e.target.closest(".movable-item");
  if (!item || !moveLayer.contains(item)) return;
  if (activeDrag) return;
  e.preventDefault();
  snapshot();
  const layerRect = moveLayer.getBoundingClientRect();
  const itemRect = item.getBoundingClientRect();
  activeDrag = {
    item,
    layerRect,
    offsetX: e.clientX - itemRect.left,
    offsetY: e.clientY - itemRect.top,
  };
  item.classList.add("dragging");
}
function moveItem(e) {
  if (!activeDrag) return;
  const { item, layerRect, offsetX, offsetY } = activeDrag;
  const maxX = Math.max(0, layerRect.width - item.offsetWidth);
  const maxY = Math.max(0, layerRect.height - item.offsetHeight);
  item.style.left = `${Math.max(0, Math.min(maxX, e.clientX - layerRect.left - offsetX))}px`;
  item.style.top = `${Math.max(0, Math.min(maxY, e.clientY - layerRect.top - offsetY))}px`;
}
moveLayer.onpointerdown = (e) => {
  beginMove(e);
  if (activeDrag && e.pointerId !== undefined) {
    try {
      moveLayer.setPointerCapture(e.pointerId);
    } catch {}
  }
};
moveLayer.onpointermove = moveItem;
moveLayer.onmousedown = beginMove;
window.addEventListener("mousemove", moveItem);
function finishMove() {
  if (!activeDrag) return;
  activeDrag.item.classList.remove("dragging");
  activeDrag = null;
  broadcast();
}
moveLayer.onpointerup = finishMove;
moveLayer.onpointercancel = finishMove;
window.addEventListener("mouseup", finishMove);
$("#textAdd").onclick = () => {
  const text = $("#textInput").value.trim();
  if (!text) return;
  const el = document.createElement("div");
  el.className = "text-item movable-item";
  el.textContent = text;
  el.style.color = state.color;
  el.style.fontSize = `${Math.max(14, Math.min(72, +$("#textSize").value || 28))}px`;
  el.style.left = "12%";
  el.style.top = `${12 + $("#equationLayer").children.length * 9}%`;
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
  el.className = "equation movable-item";
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
  $("#quizResults").innerHTML = "<b>학생 답안을 기다리는 중…</b>";
  toast("모든 학생에게 퀴즈를 출제했어요");
};
$("#revealQuiz").onclick = () => {
  if (!state.room) return toast("먼저 수업 코드를 열어 주세요");
  socket.emit("quiz-reveal", state.room);
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
    const header = document.createElement("header");
    const name = document.createElement("b");
    name.textContent = `${p.student.number}번 ${p.student.name}`;
    const live = document.createElement("span");
    live.className = "online";
    live.textContent = "● 실시간";
    const clearButton = document.createElement("button");
    clearButton.className = "student-clear";
    clearButton.textContent = "초기화";
    clearButton.onclick = (event) => {
      event.stopPropagation();
      if (confirm(`${p.student.number}번 ${p.student.name} 학생의 풀이만 초기화할까요?`))
        socket.emit("clear-student", { room: state.room, number: p.student.number });
    };
    header.append(name, live, clearButton);
    const image = document.createElement("img");
    image.alt = `${p.student.name} 학생 풀이`;
    card.append(header, image);
    card.onclick = () => {
      modalStudentNumber = p.student.number;
      $("#modalStudentName").textContent = `${p.student.number}번 ${p.student.name} 학생 풀이`;
      $("#modalStudentImage").src = image.src;
      $("#studentModal").classList.remove("hidden");
    };
    $("#studentGrid").append(card);
  }
  card.querySelector("img").src = p.image;
  if (String(modalStudentNumber) === String(p.student.number))
    $("#modalStudentImage").src = p.image;
});
$("#modalClose").onclick = () => {
  $("#studentModal").classList.add("hidden");
  modalStudentNumber = null;
};
$("#modalClear").onclick = () => {
  if (modalStudentNumber == null) return;
  socket.emit("clear-student", { room: state.room, number: modalStudentNumber });
};
socket.on("student-cleared", ({ number }) => {
  const image = $(`#student-${number} img`);
  if (image) image.removeAttribute("src");
  if (String(modalStudentNumber) === String(number))
    $("#modalStudentImage").removeAttribute("src");
  toast(`${number}번 학생의 풀이를 초기화했어요`);
});
socket.on("clear-student", () => {
  snapshot();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("#equationLayer").innerHTML = "";
  state.equations = [];
  broadcast();
  toast("선생님이 내 캔버스를 초기화했어요");
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
  $("#quizAnswer").classList.remove("hidden");
  $("#submitAnswer").classList.remove("hidden");
  $("#quizWaiting").classList.add("hidden");
  $("#quizFeedback").className = "";
  $("#quizFeedback").textContent = "";
});
$("#submitAnswer").onclick = () => {
  if (!state.quiz || state.quiz.status !== "active") return;
  const answer = $("#quizAnswer").value.trim();
  if (!answer) return toast("답을 입력해 주세요");
  socket.emit("quiz-result", {
    room: state.room,
    answer,
  });
};
socket.on("quiz-waiting", () => {
  $("#quizAnswer").classList.add("hidden");
  $("#submitAnswer").classList.add("hidden");
  $("#quizWaiting").classList.remove("hidden");
});
socket.on("quiz-progress", ({ answered, total }) => {
  $("#studentQuizProgress").textContent = `${answered}/${total}명 제출`;
  if ($("#teacher").classList.contains("active"))
    $("#quizResults").innerHTML = `<b>${answered}/${total}명 제출 완료</b>`;
});
socket.on("quiz-stats", (stats) => {
  $("#quizScore").textContent = `${stats.total}문제 · ${stats.correct}개 정답`;
});
socket.on("quiz-reveal", (result) => {
  $("#quizWaiting").classList.add("hidden");
  $("#quizAnswer").classList.add("hidden");
  $("#submitAnswer").classList.add("hidden");
  const feedback = $("#quizFeedback");
  feedback.className = result.correct ? "feedback-good" : "feedback-bad";
  feedback.innerHTML = result.correct
    ? `정답입니다! 🎉 <small>내 답: ${result.submitted}</small>`
    : `오답입니다. 정답은 <b>${result.answer}</b>입니다.<br><small>${result.explanation || "다음 문제에서는 다시 도전해 보세요!"}</small>`;
  $("#quizScore").textContent = `${result.stats.total}문제 · ${result.stats.correct}개 정답`;
});
socket.on("quiz-summary", ({ summary, answer }) => {
  if (!$("#teacher").classList.contains("active")) return;
  $("#quizResults").innerHTML = `<b>정답: ${answer}</b>`;
  for (const result of summary) {
    const line = document.createElement("span");
    line.className = result.correct ? "feedback-good" : "feedback-bad";
    line.textContent = `${result.student.number}번 ${result.student.name}: ${result.correct ? "정답" : "오답"} (${result.submitted})`;
    $("#quizResults").append(line);
  }
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
