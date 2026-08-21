(function () {
  const config = {
    apiKey: "AIzaSyDqmhLyRyv72gC5AhFTlxLAZ7DWMFa8AYE",
    authDomain: "math-canvas-live-kr-2026.firebaseapp.com",
    databaseURL: "https://math-canvas-live-kr-2026-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "math-canvas-live-kr-2026",
    storageBucket: "math-canvas-live-kr-2026.firebasestorage.app",
    messagingSenderId: "437912130678",
    appId: "1:437912130678:web:aa5cc68add74d98042bb57",
  };
  firebase.initializeApp(config);
  const db = firebase.database();
  const clean = (value) => String(value || "").trim().replace(/\s+/g, "").toLowerCase();
  const keyFor = (student) => `${student.number}_${encodeURIComponent(student.name)}`;

  window.io = function () {
    const handlers = new Map();
    const clientId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let room = "";
    let student = null;
    let attached = false;
    const fire = (event, data) => (handlers.get(event) || []).forEach((fn) => fn(data));
    const on = (event, fn) => {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(fn);
    };
    const roomRef = (path = "") => db.ref(`rooms/${room}${path ? `/${path}` : ""}`);

    async function progress() {
      const [answersSnap, presenceSnap] = await Promise.all([
        roomRef("quizAnswers").once("value"),
        roomRef("presence").once("value"),
      ]);
      const answers = answersSnap.val() || {};
      const people = presenceSnap.val() || {};
      const unique = new Set(Object.values(people).map((p) => keyFor(p.student)));
      const data = { answered: Object.keys(answers).length, total: unique.size };
      fire("quiz-progress", data);
      if (data.total > 0 && data.answered >= data.total)
        roomRef("quiz/status").transaction((status) => (status === "active" ? "revealed" : status));
    }

    async function handleReveal(quiz) {
      if (student) {
        const key = keyFor(student);
        const answerSnap = await roomRef(`quizAnswers/${key}`).once("value");
        const submitted = answerSnap.val()?.answer || "미제출";
        const correct = clean(submitted) === clean(quiz.answer);
        let statsResult = { total: quiz.questionNo || 0, correct: 0 };
        await roomRef(`quizStats/${key}`).transaction((stats) => {
          stats = stats || { total: 0, correct: 0, lastQuestionNo: 0 };
          if ((stats.lastQuestionNo || 0) < quiz.questionNo) {
            stats.total = quiz.questionNo;
            if (correct) stats.correct += 1;
            stats.lastQuestionNo = quiz.questionNo;
          }
          statsResult = stats;
          return stats;
        });
        fire("quiz-reveal", {
          correct,
          submitted,
          answer: quiz.answer,
          explanation: quiz.explanation || "",
          stats: statsResult,
        });
        fire("quiz-stats", statsResult);
      } else {
        const [answersSnap, presenceSnap] = await Promise.all([
          roomRef("quizAnswers").once("value"),
          roomRef("presence").once("value"),
        ]);
        const answers = answersSnap.val() || {};
        const people = presenceSnap.val() || {};
        const unique = new Map(Object.values(people).map((p) => [keyFor(p.student), p.student]));
        const summary = [...unique].map(([key, person]) => {
          const submitted = answers[key]?.answer || "미제출";
          return { student: person, submitted, correct: clean(submitted) === clean(quiz.answer) };
        });
        fire("quiz-summary", { summary, answer: quiz.answer });
      }
    }

    function attach() {
      if (attached || !room) return;
      attached = true;
      roomRef("canvases").on("child_added", (snap) => snap.val() && fire("drawing", snap.val()));
      roomRef("canvases").on("child_changed", (snap) => snap.val() && fire("drawing", snap.val()));
      roomRef("commands/clearRoom").on("value", (snap) => snap.val() && fire("clear-room"));
      if (student) {
        roomRef(`commands/clearStudent/${student.number}`).on("value", (snap) => snap.val() && fire("clear-student"));
        roomRef(`quizStats/${keyFor(student)}`).on("value", (snap) => snap.val() && fire("quiz-stats", snap.val()));
      }
      roomRef("quiz").on("value", async (snap) => {
        const quiz = snap.val();
        if (!quiz) return;
        fire("quiz-state", { status: quiz.status, question: quiz.question, questionNo: quiz.questionNo });
        if (quiz.status === "active" && student) {
          const own = await roomRef(`quizAnswers/${keyFor(student)}`).once("value");
          if (own.exists()) fire("quiz-waiting", { questionNo: quiz.questionNo });
        }
        if (quiz.status === "revealed") handleReveal(quiz);
      });
      roomRef("quizAnswers").on("value", () => progress());
      roomRef("wordGame").on("value", (snap) => snap.val() && fire("wordgame-state", snap.val()));
    }

    async function emit(event, payload) {
      if (event === "join") {
        room = payload.room;
        student = payload.student || null;
        if (student) {
          const presence = roomRef(`presence/${clientId}`);
          await presence.set({ student, at: firebase.database.ServerValue.TIMESTAMP });
          presence.onDisconnect().remove();
        }
        attach();
        return;
      }
      if (!room && typeof payload === "string") room = payload;
      switch (event) {
        case "drawing":
          return roomRef(`canvases/${payload.student.number}`).set(payload);
        case "request-snapshots":
          return;
        case "clear-room":
          await roomRef("canvases").remove();
          return roomRef("commands/clearRoom").set(Date.now());
        case "clear-student":
          await db.ref(`rooms/${payload.room}/canvases/${payload.number}`).remove();
          await db.ref(`rooms/${payload.room}/commands/clearStudent/${payload.number}`).set(Date.now());
          return fire("student-cleared", { number: payload.number });
        case "quiz-prepare":
          await roomRef("quizStats").remove();
          await roomRef("quizAnswers").remove();
          await roomRef("quizMeta").set({ questionNo: 0 });
          return roomRef("quiz").set({ status: "preparing" });
        case "quiz-publish": {
          const targetRoom = payload.room;
          const metaRef = db.ref(`rooms/${targetRoom}/quizMeta/questionNo`);
          const result = await metaRef.transaction((n) => (n || 0) + 1);
          const questionNo = result.snapshot.val();
          await db.ref(`rooms/${targetRoom}/quizAnswers`).remove();
          return db.ref(`rooms/${targetRoom}/quiz`).set({
            status: "active",
            question: payload.question,
            answer: payload.answer,
            explanation: payload.explanation || "",
            questionNo,
          });
        }
        case "quiz-result":
          await roomRef(`quizAnswers/${keyFor(student)}`).set({ answer: payload.answer, at: Date.now() });
          fire("quiz-waiting", {});
          return progress();
        case "quiz-reveal":
          return roomRef("quiz/status").set("revealed");
        case "quiz-end":
          return roomRef("quiz").set({ status: "ended" });
        case "wordgame-start":
          return db.ref(`rooms/${payload.room}/wordGame`).set({
            status: "active",
            timeLimit: Math.max(5, Math.min(120, Number(payload.timeLimit) || 20)),
            currentWord: payload.startWord,
            used: [payload.startWord],
            deadline: Date.now() + Math.max(5, Math.min(120, Number(payload.timeLimit) || 20)) * 1000,
            message: "게임 시작!",
          });
        case "wordgame-submit": {
          const word = String(payload.word || "").trim();
          let rejection = "";
          await db.ref(`rooms/${payload.room}/wordGame`).transaction((game) => {
            if (!game || game.status !== "active") return;
            if (Date.now() > game.deadline) rejection = "시간이 초과됐어요.";
            else if (!/^[가-힣]{2,}$/.test(word)) rejection = "두 글자 이상의 한글 단어를 입력하세요.";
            else if ((game.used || []).includes(word)) rejection = "이미 나온 단어예요.";
            else if (word[0] !== game.currentWord.slice(-1)) rejection = `‘${game.currentWord.slice(-1)}’으로 시작해야 해요.`;
            if (rejection) return;
            game.currentWord = word;
            game.used = [...(game.used || []), word];
            game.deadline = Date.now() + game.timeLimit * 1000;
            game.message = `${payload.student.number}번 ${payload.student.name} 성공!`;
            return game;
          });
          if (rejection) fire("wordgame-reject", rejection);
          return;
        }
        case "wordgame-end":
          return db.ref(`rooms/${payload}/wordGame`).set({ status: "ended" });
      }
    }
    return { on, emit };
  };
})();
