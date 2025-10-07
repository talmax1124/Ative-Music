# 🦕 Pterodactyl Deployment - Port 25567 REQUIRED

## ⚠️ CRITICAL REQUIREMENT
**Port 25567 MUST be allocated to your Pterodactyl server for the web panel to work.**

## 🔍 Step 1: Check Current Allocations
1. **Log into your Pterodactyl panel**
2. **Go to: Your Server → Settings → Allocations**
3. **Look for:** `199.244.48.46:25567` or similar

### ✅ If you see port 25567 listed:
You're ready to deploy! Skip to Step 3.

### ❌ If port 25567 is NOT listed:
Continue to Step 2.

---

## 🛠️ Step 2: Request Port 25567 Allocation

### Option A: You have Admin Access
1. **Admin Panel** → **Servers** → **[Your Server]**
2. **Build Tab** → **Additional Allocations**
3. **Add:** `25567`
4. **Save Configuration**
5. **Restart Server**

### Option B: Contact Your Administrator
**Copy and send this message:**
```
Subject: Port 25567 Allocation Request

Hi,

I need port 25567 allocated to my Pterodactyl server for my Discord bot's web interface.

Server: [Your Server Name/ID]
Required Port: 25567
Purpose: Music bot web control panel

The bot is configured to use only this specific port and cannot use alternatives.

Thank you!
```

---

## 🚀 Step 3: Deploy Your Bot

### Upload Files
1. **Upload/Git clone** your bot files to Pterodactyl
2. **Ensure your `.env` file** has these exact settings:
```env
WEB_HOST=0.0.0.0
WEB_PORT=25567
PUBLIC_HOST=panel.creativeduo.net
PUBLIC_PORT=25567
```

### Start the Bot
1. **Start your server** in Pterodactyl
2. **Check console** for this message:
```
🌐 Web portal listening on http://0.0.0.0:25567
🕸️ Web portal started: http://panel.creativeduo.net:25567
```

---

## 🎯 Access Your Web Panel

Once deployed and port 25567 is allocated:
- **Domain:** http://panel.creativeduo.net:25567
- **Direct IP:** http://199.244.48.46:25567

---

## 🚨 Troubleshooting

### "Connection Refused" or "Site Can't Be Reached"
**Cause:** Port 25567 is not allocated in Pterodactyl
**Solution:** Complete Step 2 above

### "Web portal started: undefined"
**Cause:** Environment variables not loading
**Solution:** Ensure `.env` file is properly uploaded with correct settings

### Bot starts but web panel doesn't load
**Cause:** Pterodactyl firewall blocking port 25567
**Solution:** Contact administrator to ensure port 25567 is open in firewall

---

## ✅ Verification Checklist

- [ ] Port 25567 is listed in Pterodactyl allocations
- [ ] `.env` file contains correct WEB_PORT=25567
- [ ] Bot console shows "Web portal started: http://panel.creativeduo.net:25567"
- [ ] Web panel loads at http://panel.creativeduo.net:25567

**Once all items are checked, your web panel will be accessible!**