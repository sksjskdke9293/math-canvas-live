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
io.on('connection', socket => {
  socket.on('join', ({ room, student }) => {
    socket.join(room); socket.data.room = room; socket.data.student = student;
    if (student) io.to(room).emit('presence', { id: socket.id, student, online: true });
    if (quizzes.has(room)) socket.emit('quiz-state', quizzes.get(room));
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
  socket.on('disconnect', () => {
    if (socket.data.room && socket.data.student) io.to(socket.data.room).emit('presence', { id: socket.id, student: socket.data.student, online: false });
  });
});

server.listen(process.env.PORT || 3000, () => console.log('Math Canvas Live ready'));
