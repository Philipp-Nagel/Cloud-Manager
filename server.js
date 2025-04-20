// server.js - Main file for the cloud manager
const express = require('express');
const axios = require('axios');
const https = require('https');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// App configuration
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration file
const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {
  users: [],
  proxmoxApi: {
    host: 'your_actual_proxmox_host_here',
    tokenId: 'your_actual_pve_api_token_here',
    tokenSecret: 'your_actual_pve_api_token_secret_here',
    node: 'your_actual_pve_hostname_here' 
  },
  containerDefaults: {
    baseId: 1000,
    password: 'your_password_for_lxc_here',
    network: 'your_actual_LXC_network_here',
    template: 'local:vztmpl/your_actual_lxc_Template_here'
  }
};

// Initializing the configuration
if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (err) {
    console.error('Error loading configuration :', err);
  }
} else {
  const createDefaultAdmin = async () => {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin', salt);
    config.users.push({
      username: 'admin',
      password: hashedPassword,
      isAdmin: true
    });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    console.log('Default admin created (user: admin, password: admin)');
  };
  createDefaultAdmin();
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'proxmox-cloud-manager-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // Set to true if HTTPS is used
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Proxmox API-Integration
const proxmoxApi = axios.create({
  baseURL: `https://${config.proxmoxApi.host}:8006/api2/json`,
  headers: {
    'Authorization': `PVEAPIToken=${config.proxmoxApi.tokenId}=${config.proxmoxApi.tokenSecret}`
  },
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

// Auth Middleware
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
};

const isAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.isAdmin) {
    return next();
  }
  res.status(403).send('Access Denied');
};

// Routes
app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  const user = config.users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ error: 'Wrong Username or Password' });
  }
  
  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ error: 'Worng Username or Password' });
  }
  
  req.session.user = {
    username: user.username,
    isAdmin: user.isAdmin
  };
  
  res.json({ success: true });
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

app.get('/dashboard', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API routes for container management
app.get('/api/containers', isAuthenticated, async (req, res) => {
  try {
    const response = await proxmoxApi.get(`/nodes/${config.proxmoxApi.node}/lxc`);
    res.json(response.data.data);
  } catch (error) {
    console.error('Error retrieving containers:', error);
    res.status(500).json({ error: 'Error retrieving containers' });
  }
});

app.post('/api/containers', isAuthenticated, async (req, res) => {
  try {
    // Find the next free ID
    const existingContainers = await proxmoxApi.get(`/nodes/${config.proxmoxApi.node}/lxc`);
    const usedIds = existingContainers.data.data.map(container => parseInt(container.vmid));
    
    let nextId = config.containerDefaults.baseId + 1;
    while (usedIds.includes(nextId)) {
      nextId++;
    }
    
    // Hostname from user or generated
    const hostname = req.body.hostname || `container-${nextId}`;
    
    // Container create
    const containerConfig = {
      vmid: nextId,
      ostemplate: config.containerDefaults.template,
      hostname: hostname,
      password: config.containerDefaults.password,
      net0: `name=eth0,bridge=${config.containerDefaults.network},ip=dhcp`,
      memory: req.body.memory || 512,
      swap: req.body.swap || 512,
      storage: req.body.storage || 'local',
      rootfs: `${req.body.storage || 'local'}:${req.body.disksize || 8}`,
      cores: req.body.cores || 1,
      start: req.body.start || 1
    };
    
    await proxmoxApi.post(`/nodes/${config.proxmoxApi.node}/lxc`, new URLSearchParams(containerConfig));
    
    res.json({ 
      success: true, 
      message: `Container ${nextId} created`, 
      container: {
        vmid: nextId,
        hostname: hostname
      }
    });
  } catch (error) {
    console.error('Error creating container:', error.response?.data || error);
    res.status(500).json({ 
      error: 'Error creating container', 
      details: error.response?.data?.message || error.message 
    });
  }
});

app.delete('/api/containers/:id', isAuthenticated, async (req, res) => {
  const containerId = req.params.id;
  
  try {
    // Check if the container is running and stop if necessary
    const containerStatus = await proxmoxApi.get(`/nodes/${config.proxmoxApi.node}/lxc/${containerId}/status/current`);
    if (containerStatus.data.data.status === 'running') {
      await proxmoxApi.post(`/nodes/${config.proxmoxApi.node}/lxc/${containerId}/status/stop`);
      
      // Wait until the container is stopped
      let stopped = false;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const status = await proxmoxApi.get(`/nodes/${config.proxmoxApi.node}/lxc/${containerId}/status/current`);
        if (status.data.data.status === 'stopped') {
          stopped = true;
          break;
        }
      }
      
      if (!stopped) {
        return res.status(500).json({ error: 'Container konnte nicht gestoppt werden' });
      }
    }
    
    // Container delete
    await proxmoxApi.delete(`/nodes/${config.proxmoxApi.node}/lxc/${containerId}`);
    
    res.json({ success: true, message: `Container ${containerId} delete` });
  } catch (error) {
    console.error('Error deleting container:', error);
    res.status(500).json({ error: 'Error deleting container' });
  }
});

// User routes (admins only)
app.get('/api/users', isAuthenticated, isAdmin, (req, res) => {
  const usersList = config.users.map(u => ({
    username: u.username,
    isAdmin: u.isAdmin
  }));
  res.json(usersList);
});

app.post('/api/users', isAuthenticated, isAdmin, async (req, res) => {
  const { username, password, isAdmin } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  if (config.users.some(u => u.username === username)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    config.users.push({
      username,
      password: hashedPassword,
      isAdmin: isAdmin === true
    });
    
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    
    res.json({ success: true, message: 'User created' });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Error creating user' });
  }
});

app.delete('/api/users/:username', isAuthenticated, isAdmin, (req, res) => {
  const username = req.params.username;
  
  // Verhindern, dass der letzte Admin gelöscht wird
  const admins = config.users.filter(u => u.isAdmin);
  if (admins.length === 1 && admins[0].username === username) {
    return res.status(400).json({ error: 'The last admin cannot be deleted' });
  }
  
  const initialLength = config.users.length;
  config.users = config.users.filter(u => u.username !== username);
  
  if (config.users.length === initialLength) {
    return res.status(404).json({ error: 'User not Found' });
  }
  
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  
  res.json({ success: true, message: 'User deleted' });
});

// Settings routes (admins only)
app.get('/api/settings', isAuthenticated, (req, res) => {
  const settings = {
    proxmoxApi: {
      host: config.proxmoxApi.host,
      node: config.proxmoxApi.node
    },
    containerDefaults: config.containerDefaults
  };
  
  res.json(settings);
});

app.post('/api/settings', isAuthenticated, isAdmin, (req, res) => {
  const { proxmoxApi, containerDefaults } = req.body;
  
  if (proxmoxApi) {
    if (proxmoxApi.host) config.proxmoxApi.host = proxmoxApi.host;
    if (proxmoxApi.node) config.proxmoxApi.node = proxmoxApi.node;
    if (proxmoxApi.tokenId) config.proxmoxApi.tokenId = proxmoxApi.tokenId;
    if (proxmoxApi.tokenSecret) config.proxmoxApi.tokenSecret = proxmoxApi.tokenSecret;
  }
  
  if (containerDefaults) {
    if (containerDefaults.baseId) config.containerDefaults.baseId = parseInt(containerDefaults.baseId);
    if (containerDefaults.password) config.containerDefaults.password = containerDefaults.password;
    if (containerDefaults.network) config.containerDefaults.network = containerDefaults.network;
    if (containerDefaults.template) config.containerDefaults.template = containerDefaults.template;
  }
  
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  
  // Aktualisierung der API-Konfiguration
  proxmoxApi.defaults.baseURL = `https://${config.proxmoxApi.host}:8006/api2/json`;
  proxmoxApi.defaults.headers['Authorization'] = `PVEAPIToken=${config.proxmoxApi.tokenId}=${config.proxmoxApi.tokenSecret}`;
  
  res.json({ success: true, message: 'Settings updated' });
});

// Error-Handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Server starten
app.listen(PORT, () => {
  console.log(`Server runs on port ${PORT}`);
});