const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();

// ============= MIDDLEWARE =============
app.use(express.json());
app.use(cors({
  origin: process.env.CLIENT_URL,
  credentials: true
}));

// ============= MONGODB CONNECTION =============
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB Connected'))
  .catch((err) => console.error('❌ MongoDB Error:', err));

// ============= MONGOOSE SCHEMAS =============

// User Model
const userSchema = new mongoose.Schema({
  firebaseUID: { type: String, required: true, unique: true },
  name: { type: String },
  email: { type: String, required: true, unique: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Project Model
const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  tags: [String],
  githubRepo: { type: String, required: true },
  liveDemo: String,
  authorUID: { type: String, required: true }, // Firebase UID, not MongoDB ID
  likes: { type: Number, default: 0 },
  likedBy: [String], // Array of Firebase UIDs
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Project = mongoose.model('Project', projectSchema);

// ============= FIREBASE VERIFICATION MIDDLEWARE =============
const verifyFirebaseToken = (req, res, next) => {
  const token = req.headers.authorization?.split('Bearer ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  // For now, we'll trust the frontend to send the correct firebaseUID in the body
  // In production, verify the token with Firebase Admin SDK
  next();
};

// ============= ROUTES =============


app.get('/api/health', (req, res) => {
  res.json({ message: '✅ Server running', timestamp: new Date() });
});

// ===== AUTH ROUTES =====

// Register/Sync User
app.post('/api/auth/register', async (req, res) => {
  try {
    const { firebaseUID, name, email } = req.body;

    if (!firebaseUID || !email) {
      return res.status(400).json({ error: 'Missing firebaseUID or email' });
    }

    let user = await User.findOne({ firebaseUID });
    
    if (user) {
      return res.status(200).json({ message: 'User already exists', user });
    }

    user = new User({ firebaseUID, name, email });
    await user.save();
    res.status(201).json({ message: 'User created', user });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get User Profile
app.get('/api/auth/profile', async (req, res) => {
  try {
    const { uid } = req.query;
    
    if (!uid) {
      return res.status(400).json({ error: 'UID required' });
    }

    const user = await User.findOne({ firebaseUID: uid });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== PROJECT ROUTES =====

app.get('/api/projects', async (req, res) => {
  try {
    const { tag, search } = req.query;
    let query = {};

    if (tag) {
      query.tags = tag;
    }

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    const projects = await Project.find(query).sort({ createdAt: -1 });
    res.status(200).json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Single Project
app.get('/api/projects/:id', async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.status(200).json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create Project (Authenticated)
app.post('/api/projects', verifyFirebaseToken, async (req, res) => {
  try {
    const { title, description, tags, githubRepo, liveDemo, firebaseUID } = req.body;

    if (!firebaseUID) {
      return res.status(400).json({ error: 'firebaseUID required' });
    }

    const project = new Project({
      title,
      description,
      tags: tags || [],
      githubRepo,
      liveDemo,
      authorUID: firebaseUID
    });

    await project.save();
    res.status(201).json({ message: 'Project created', project });
  } catch (error) {
    console.error('Create project error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update Project (Admin Only - Check firebaseUID)
app.put('/api/projects/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { firebaseUID } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if user is the author
    if (project.authorUID !== firebaseUID) {
      return res.status(403).json({ error: 'Not authorized to update this project' });
    }

    const updatedProject = await Project.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true }
    );

    res.status(200).json({ message: 'Project updated', project: updatedProject });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Project (Admin Only)
app.delete('/api/projects/:id', verifyFirebaseToken, async (req, res) => {
  try {
    const { firebaseUID } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if user is the author
    if (project.authorUID !== firebaseUID) {
      return res.status(403).json({ error: 'Not authorized to delete this project' });
    }

    await Project.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: 'Project deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Like Project
app.post('/api/projects/:id/like', async (req, res) => {
  try {
    const { firebaseUID } = req.body;
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if already liked
    if (project.likedBy.includes(firebaseUID)) {
      // Unlike
      project.likedBy = project.likedBy.filter(uid => uid !== firebaseUID);
      project.likes = Math.max(0, project.likes - 1);
    } else {
      // Like
      project.likedBy.push(firebaseUID);
      project.likes += 1;
    }

    await project.save();
    res.status(200).json({ message: 'Like updated', project });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============= ERROR HANDLING =============
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============= START SERVER =============
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log('📡 API Health: http://localhost:' + PORT + '/api/health');
});
