const express = require('express');
const cors = require('cors');
// const { PrismaClient } = require('@prisma/client');
// const bcrypt = require('bcryptjs');
// const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
// const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Auth middleware
// const authenticateToken = (req, res, next) => {
//   const authHeader = req.headers['authorization'];
//   const token = authHeader && authHeader.split(' ')[1];

//   if (!token) return res.sendStatus(401);

//   jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
//     if (err) return res.sendStatus(403);
//     req.user = user;
//     next();
//   });
// };

// Routes

// Register
app.post('/api/auth/register', async (req, res) => {
  res.status(201).json({ message: 'Register endpoint working' });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  res.json({ message: 'Login endpoint working' });
});

// Get user profile
app.get('/api/user', (req, res) => {
  res.json({ message: 'User endpoint working' });
});

// CRUD for Emails

// Get all emails for user
app.get('/api/emails', (req, res) => {
  res.json({ message: 'Emails endpoint working' });
});

// Create email
app.post('/api/emails', (req, res) => {
  res.status(201).json({ message: 'Create email endpoint working' });
});

// Update email
app.put('/api/emails/:id', (req, res) => {
  res.json({ message: 'Update email endpoint working' });
});

// Delete email
app.delete('/api/emails/:id', (req, res) => {
  res.sendStatus(204);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});