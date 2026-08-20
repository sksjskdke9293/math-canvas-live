const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 5e6 });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({ ok: true }));

const rooms = new Map();
const quizzes = new Map();
const wordGames = new Map();
const dictionaryCache = new Map();
async function isStandardWord(word) {
  if (dictionaryCache.has(word)) return dictionaryCache.get(word);
  let valid = false;
  try {
    if (process.env.STDICT_API_KEY) {
      const url = `https://stdict.korean.go.kr/api/search.do?certkey_no=1&key=${encodeURIComponent(process.env.STDICT_API_KEY)}&type_search=search&q=${encodeURIComponent(word)}`;
      const text = await (await fetch(url)).text();
      valid = text.includes(`<word>${word}</word>`) || text.includes(`><![CDATA[${word}]]>`);
    } else {
      const url = `https://stdict.korean.go.kr/search/searchResult.do?pageSize=10&searchKeyword=${encodeURIComponent(word)}`;
      const text = await (await fetch(url, { headers: { 'user-agent': 'MathCanvasLive/1.0' } })).text();
      valid = text.includes('word_no=') && text.replace(/<[^>]+>/g, '').includes(word);
    }
  } catch (_) {}
  dictionaryCache.set(word, valid); return valid;
}
io.on('connection', socket => {
  socket.on('join', ({ room, student }) => {
    socket.join(room); socket.data.room = room; socket.data.student = student;
    if (student) io.to(room).emit('presence', { id: socket.id, student, online: true });
    if (quizzes.has(room)) socket.emit('quiz-state', quizzes.get(room));
    if (wordGames.has(room)) socket.emit('wordgame-state', wordGames.get(room));
  });
  socket.on('drawing', payload => {
    if (!socket.data.room) return;
    const key = `${socket.data.room}:${payload.student?.number || 'board'}`;
    rooms.set(key, payload);
    socket.to(socket.data.room).emit('drawing', payload);
  });
  socket.on('request-snapshots', room => {
    for (const [key, value] of rooms) if (key.startsWith(`${room}:`)) socket.emit('drawing', value);
  });
  socket.on('clear-room', room => {
    for (const key of [...rooms.keys()]) if (key.startsWith(`${room}:`)) rooms.delete(key);
    io.to(room).emit('clear-room');
  });
  socket.on('quiz-prepare', room => {
    wordGames.delete(room); io.to(room).emit('wordgame-state', { status: 'ended' });
    const quiz = { status: 'preparing' };
    quizzes.set(room, quiz); io.to(room).emit('quiz-state', quiz);
  });
  socket.on('quiz-publish', ({ room, question, answer, explanation }) => {
    const quiz = { status: 'active', question, answer, explanation: explanation || '' };
    quizzes.set(room, quiz); io.to(room).emit('quiz-state', quiz);
  });
  socket.on('quiz-end', room => {
    quizzes.delete(room); io.to(room).emit('quiz-state', { status: 'ended' });
  });
  socket.on('quiz-result', ({ room, student, correct }) => {
    io.to(room).emit('quiz-student-result', { student, correct });
  });
  socket.on('wordgame-start', ({ room, timeLimit, startWord }) => {
    quizzes.delete(room); io.to(room).emit('quiz-state', { status: 'ended' });
    const seconds = Math.max(5, Math.min(120, Number(timeLimit) || 20));
    const game = { status: 'active', timeLimit: seconds, currentWord: startWord.trim(), used: [startWord.trim()], deadline: Date.now() + seconds * 1000, message: '게임 시작!' };
    wordGames.set(room, game); io.to(room).emit('wordgame-state', game);
  });
  socket.on('wordgame-submit', async ({ room, student, word }) => {
    const game = wordGames.get(room); word = String(word || '').trim();
    if (!game || game.status !== 'active') return;
    let error = '';
    if (Date.now() > game.deadline) error = '시간이 초과됐어요.';
    else if (!/^[가-힣]{2,}$/.test(word)) error = '두 글자 이상의 한글 단어를 입력하세요.';
    else if (game.used.includes(word)) error = '이미 나온 단어예요.';
    else if (word[0] !== game.currentWord.at(-1)) error = `‘${game.currentWord.at(-1)}’으로 시작해야 해요.`;
    else if (!(await isStandardWord(word))) error = '표준국어대사전에서 찾을 수 없는 단어예요.';
    if (error) return socket.emit('wordgame-reject', error);
    game.currentWord = word; game.used.push(word); game.deadline = Date.now() + game.timeLimit * 1000; game.message = `${student.number}번 ${student.name} 성공!`;
    io.to(room).emit('wordgame-state', game);
  });
  socket.on('wordgame-end', room => { wordGames.delete(room); io.to(room).emit('wordgame-state', { status: 'ended' }); });
  socket.on('disconnect', () => {
    if (socket.data.room && socket.data.student) io.to(socket.data.room).emit('presence', { id: socket.id, student: socket.data.student, online: false });
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Math Canvas Live ready'));
