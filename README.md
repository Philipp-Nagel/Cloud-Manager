# Proxmox Cloud Manager

A web-based management interface for Proxmox Virtual Environment, allowing you to easily create and manage LXC containers through a user-friendly dashboard.

## Features

- **User-friendly Dashboard**: Manage your LXC containers through an intuitive web interface
- **Container Management**: Create, view, and delete containers
- **User Administration**: Create and manage user accounts with different permission levels
- **Customizable Settings**: Configure default container parameters and Proxmox API access
- **Multi-user Support**: Administrator and regular user roles with appropriate permissions
- **Responsive Design**: Works on desktop and mobile devices

## Requirements

- Proxmox Virtual Environment (tested with PVE 7.x and 8.x)
- Debian-based LXC container (Debian 12 recommended)
- Node.js 14.x or higher
- NPM 6.x or higher
- Valid Proxmox API token with appropriate permissions

## Installation Guide

### 1. Create a container on your Proxmox host

Login to your Proxmox host and create a new LXC container:

```bash
# On the Proxmox host
pct create 1000 local:vztmpl/debian-12-standard_12.0-1_amd64.tar.zst --hostname cloud-manager --memory 1024 --net0 name=eth0,bridge=vmbr0,ip=dhcp
pct start 1000
pct enter 1000
```

### 2. Install required packages

Install the necessary packages in the container:

```bash
apt update && apt upgrade -y
apt install -y curl nodejs npm git
```

### 3. Clone the repository

Navigate to the /opt directory and clone the repository:

```bash
cd /opt
git clone https://git.elsena.de/philipp.nagel/Cloud-Manager.git
cd cloud-manager
```

### 4. Install dependencies

Install the required Node.js packages:

```bash
npm init -y
npm install express axios body-parser express-session bcrypt
```

### 5. Create system service

Create a system service to start the application automatically on system boot:

```bash
nano /etc/systemd/system/cloud-manager.service
```

Add the following content:

```
[Unit]
Description=Proxmox Cloud Manager
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/cloud-manager
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=cloud-manager

[Install]
WantedBy=multi-user.target
```

Save the file and enable the service:

```bash
systemctl daemon-reload
systemctl enable cloud-manager
systemctl start cloud-manager
reboot
```

## Configuration

### Initial Access

After installation, access the Cloud Manager through a web browser:

```
http://CONTAINER-IP:3000
```

Replace `CONTAINER-IP` with the actual IP address of the LXC container.

Use these default credentials for the first login:
- Username: `admin`
- Password: `admin`

**Important:** At the moment it is not possible to change the password.

### Proxmox API Configuration

After logging in, verify the settings and ensure that the Proxmox API credentials are correct:

1. Navigate to the Settings page
2. Configure:
   - Host: Your Proxmox host IP or FQDN
   - Node: Your Proxmox node name (usually "pve")
   - Token ID: Your Proxmox API token ID (format: user@realm!tokenname)
   - Token Secret: Your Proxmox API token secret

### Container Defaults

Check and adjust the container default values:
- Base ID: Starting ID for new containers (default: 1000)
- Default Password: Password used for new containers
- Network Bridge: Default network bridge (e.g., vmbr0)
- Template: Your preferred container template

## Security Recommendations

1. **Change default credentials immediately** after installation
2. **Set up HTTPS** using a reverse proxy like Nginx
3. **Create strong passwords** for both the Cloud Manager and container defaults
4. **Use a dedicated API token** with appropriate permissions
5. **Restrict access** to the management interface

## Optional: HTTPS Setup

For secure connections, it's recommended to set up HTTPS. This can be done using a reverse proxy like Nginx.

## Troubleshooting

If you encounter issues:

1. Check the logs:
   ```bash
   journalctl -u cloud-manager
   ```

2. Ensure the Proxmox API token has the correct permissions

3. Verify network connectivity between the container and Proxmox host

4. Check for configuration errors in the `config.json` file

## Project Structure

```
/opt/cloud-manager/
├── server.js           # Main application file
├── config.json         # Configuration file (created on first run)
├── public/             # Web interface files
│   ├── login.html      # Login page
│   └── dashboard.html  # Dashboard interface
└── node_modules/       # Node.js dependencies
```