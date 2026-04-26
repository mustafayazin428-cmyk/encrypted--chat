let currentUser = null;
let currentChatWith = null;
let aesKeys = {};
let publicKeys = {};
let socket = null;

// ───────────────────────────────────────────────
// WebSocket
// ───────────────────────────────────────────────

function initSocket(username) {
    socket = io();

    socket.on('connect', () => {
        socket.emit('join', { username: username });
    });

    socket.on('new_message', async (msg) => {
        if (!aesKeys[msg.from]) {
            await fetchAESKeyFromServer(msg.from);
        }
        displayMessage(msg.from, null, msg.encrypted_message, msg.timestamp, false);
    });

    socket.on('disconnect', () => {
        console.log('WebSocket disconnected');
    });
}

// ───────────────────────────────────────────────
// Register
// ───────────────────────────────────────────────

async function register() {
    const username = document.getElementById('username').value.trim();
    if (!username) {
        alert('الرجاء إدخال اسم المستخدم');
        return;
    }

    currentUser = username;

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });

        const data = await response.json();

        if (response.ok) {
            document.getElementById('publicKeyDisplay').innerText =
                data.public_key.substring(0, 50) + '...';
            document.getElementById('loginScreen').style.display = 'none';
            document.getElementById('chatScreen').style.display = 'block';

            initSocket(username);
            loadUsers();
            setInterval(loadUsers, 5000);

            // جلب الرسائل القديمة من قاعدة البيانات
            loadOldMessages();
        } else {
            alert('خطأ: ' + data.error);
        }
    } catch (error) {
        alert('خطأ في الاتصال');
    }
}

// ───────────────────────────────────────────────
// Users
// ───────────────────────────────────────────────

async function loadUsers() {
    try {
        const response = await fetch('/get_users');
        const data = await response.json();
        const userSelect = document.getElementById('userSelect');
        const currentValue = userSelect.value;

        userSelect.innerHTML = '<option value="">اختر مستخدم...</option>';

        for (const user of data.users) {
            if (user !== currentUser) {
                const option = document.createElement('option');
                option.value = user;
                option.textContent = user;
                userSelect.appendChild(option);
            }
        }

        if (currentValue && data.users.includes(currentValue)) {
            userSelect.value = currentValue;
            currentChatWith = currentValue;
        }
    } catch (error) {
        console.error(error);
    }
}

// ───────────────────────────────────────────────
// AES Key Exchange
// ───────────────────────────────────────────────

async function exchangeAESKey(targetUser) {
    const newAESKey = crypto.getRandomValues(new Uint8Array(32));

    let publicKeyPEM = publicKeys[targetUser];
    if (!publicKeyPEM) {
        const response = await fetch(`/get_public_key/${targetUser}`);
        const data = await response.json();
        publicKeyPEM = data.public_key;
        publicKeys[targetUser] = publicKeyPEM;
    }

    const publicKey = await importPublicKey(publicKeyPEM);

    const encryptedAESKey = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        publicKey,
        newAESKey
    );

    const encryptedB64 = btoa(String.fromCharCode(...new Uint8Array(encryptedAESKey)));

    await fetch('/exchange_aes_key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from_user: currentUser,
            to_user: targetUser,
            encrypted_aes_key: encryptedB64
        })
    });

    aesKeys[targetUser] = newAESKey;

    const msgDiv = document.getElementById('messages');
    const sysMsg = document.createElement('div');
    sysMsg.className = 'system-msg';
    sysMsg.style.color = 'green';
    sysMsg.innerHTML = `✅ تم تبادل مفتاح التشفير مع ${targetUser}`;
    msgDiv.appendChild(sysMsg);
    setTimeout(() => sysMsg.remove(), 3000);
}

async function fetchAESKeyFromServer(fromUser) {
    try {
        const response = await fetch(`/get_aes_key/${currentUser}/${fromUser}`);
        if (response.ok) {
            const data = await response.json();
            if (data.aes_key) {
                const keyBytes = Uint8Array.from(atob(data.aes_key), c => c.charCodeAt(0));
                aesKeys[fromUser] = keyBytes;
            }
        }
    } catch (error) {
        console.error('خطأ في جلب المفتاح:', error);
    }
}

// ───────────────────────────────────────────────
// Messages
// ───────────────────────────────────────────────

async function sendMessage() {
    if (!currentChatWith) {
        alert('اختر مستخدم للدردشة');
        return;
    }

    const plaintext = document.getElementById('messageInput').value.trim();
    if (!plaintext) return;

    if (!aesKeys[currentChatWith]) {
        await exchangeAESKey(currentChatWith);
    }

    const encrypted = await encryptWithAES(aesKeys[currentChatWith], plaintext);

    await fetch('/send_message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from: currentUser,
            to: currentChatWith,
            encrypted_message: encrypted,
            timestamp: new Date().toISOString()
        })
    });

    displayMessage(currentUser, plaintext, encrypted, new Date().toISOString(), true);
    document.getElementById('messageInput').value = '';
}

async function loadOldMessages() {
    try {
        const response = await fetch(`/get_messages/${currentUser}`);
        const data = await response.json();

        for (const msg of data.messages) {
            if (!aesKeys[msg.from_user]) {
                await fetchAESKeyFromServer(msg.from_user);
            }
            displayMessage(msg.from_user, null, msg.encrypted_message, msg.timestamp, false);
        }

        await fetch(`/clear_messages/${currentUser}`, { method: 'POST' });
    } catch (error) {
        console.error(error);
    }
}

// ───────────────────────────────────────────────
// Crypto Helpers
// ───────────────────────────────────────────────

async function importPublicKey(pem) {
    const binaryDerString = atob(pem.replace(/-----[^-]+-----/g, '').replace(/\n/g, ''));
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(i);
    }
    return await crypto.subtle.importKey(
        "spki",
        binaryDer,
        { name: "RSA-OAEP", hash: "SHA-256" },
        true,
        ["encrypt"]
    );
}

async function encryptWithAES(key, plaintext) {
    const encodedText = new TextEncoder().encode(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(16));

    const cryptoKey = await crypto.subtle.importKey(
        "raw", key, { name: "AES-CBC" }, false, ["encrypt"]
    );

    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-CBC", iv }, cryptoKey, encodedText
    );

    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...result));
}

async function decryptMessage(btn, encryptedB64, sender) {
    const decryptedDiv = btn.nextElementSibling;

    if (sender === currentUser) {
        const plaintext = btn.getAttribute('data-plaintext');
        decryptedDiv.innerHTML = `📄 "${plaintext}"`;
        decryptedDiv.style.display = "block";
        btn.style.display = "none";
        return;
    }

    let aesKey = aesKeys[sender];

    if (!aesKey) {
        decryptedDiv.innerHTML = "⏳ جاري جلب المفتاح...";
        decryptedDiv.style.display = "block";
        await fetchAESKeyFromServer(sender);
        aesKey = aesKeys[sender];

        if (!aesKey) {
            decryptedDiv.innerHTML = "❌ لا يوجد مفتاح - أرسل رسالة أولاً لتبادل المفتاح";
            return;
        }
    }

    try {
        const encryptedData = Uint8Array.from(atob(encryptedB64), c => c.charCodeAt(0));
        const iv = encryptedData.slice(0, 16);
        const ciphertext = encryptedData.slice(16);

        const cryptoKey = await crypto.subtle.importKey(
            "raw", aesKey, { name: "AES-CBC" }, false, ["decrypt"]
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: "AES-CBC", iv }, cryptoKey, ciphertext
        );

        const plaintext = new TextDecoder().decode(decrypted);
        decryptedDiv.innerHTML = `📄 "${plaintext}"`;
        decryptedDiv.style.display = "block";
        btn.style.display = "none";
    } catch (error) {
        decryptedDiv.innerHTML = "❌ فشل فك التشفير";
        decryptedDiv.style.display = "block";
        console.error(error);
    }
}

// ───────────────────────────────────────────────
// Display
// ───────────────────────────────────────────────

function displayMessage(sender, plaintext, encryptedMsg, timestamp, isSent = false) {
    const messagesDiv = document.getElementById('messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;

    const time = new Date(timestamp).toLocaleTimeString();
    const escapedEncrypted = encryptedMsg.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const escapedPlaintext = plaintext ? plaintext.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';

    messageDiv.innerHTML = `
        <div class="message-header">
            <strong>${sender}</strong> ${time}
        </div>
        <div class="encrypted-text">
            🔒 ${encryptedMsg.substring(0, 50)}...
        </div>
        <button class="decrypt-btn"
            data-plaintext="${escapedPlaintext}"
            onclick="decryptMessage(this, '${escapedEncrypted}', '${sender}')">
            🔓 فك التشفير
        </button>
        <div class="decrypted-result" style="margin-top:5px; display:none;"></div>
    `;

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// ───────────────────────────────────────────────
// Events
// ───────────────────────────────────────────────

document.getElementById('userSelect')?.addEventListener('change', (e) => {
    currentChatWith = e.target.value;
    if (currentChatWith && !aesKeys[currentChatWith]) {
        exchangeAESKey(currentChatWith);
    }
});

document.getElementById('messageInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});