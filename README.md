<h1>🛢 VaultNET</h1>

VaultNET is a lightweight local file server that lets you upload, browse, and download files from your own machine.
It is designed for personal use on a home or small LAN without relying on cloud services.

<img width="1837" height="906" alt="image" src="https://github.com/user-attachments/assets/dd86e999-0f25-4e7e-a2ce-858b32a7707d" />

<h2>🚀 Features</h2>

<ul>
<li>♾️ Limitless own local storage</li>
<li>🔒 Maximum privacy</li>
<li>💻 User-friendly interface</li>
<li>🔍 Filtering system</li>
<li>🛢 SQL integration</li>
</ul>

<h2>📦 Installation</h2>

<h3>Make sure you have Node.js and npm installed.</h3>

First, clone the repository:
````
git clone https://github.com/Usupru/Vault.git
cd VaultNET
````

Navigate to the backend folder
````
cd backend
````

Install dependencies:
````
npm install
````

<h2>⚙️ Usage</h2>

Start the server:
````
node server.js
````

Open in your browser:
````
http://localhost:3000
````

To access from another device on the same network, use your PC IP:
````
http://YOUR_LOCAL_IP:3000
````

<h2>🧠 Notes</h2>

<ul>
<li>Files are stored in <code>backend/uploads</code> on the host machine</li>
<li>This project is meant for personal and local network use</li>
<li>Not intended for remote access across the internet due to security concerns</li>
</ul>
