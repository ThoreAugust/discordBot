require('dotenv').config()
const Discord = require('discord.js')
const Twit = require('twit')
const ytdl = require('ytdl-core')
const TwitchApi = require('node-twitch').default
const schedule = require('node-schedule')

const client = new Discord.Client({ partials: ['MESSAGE', 'CHANNEL', 'REACTION'] })
const twitter = new Twit({
    consumer_key: process.env.TWITTER_CONSUMER_KEY,
    consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
    access_token: process.env.TWITTER_ACCESS_KEY,
    access_token_secret: process.env.TWITTER_ACCESS_SECRET, 
    timeout_ms:           60*1000,  // optional HTTP request timeout to apply to all requests.
    strictSSL:            true,     // optional - requires SSL certificates to be valid.
})
const twitch = new TwitchApi({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET
})
const botPrefix = "!"
const botCommands = [
    {command: "play", desc: "**!play {Youtube-Link}**, im Musik Channel, um ein Lied der Playlist hinzuzufügen. Wenn kein Lied in der Playlist ist wird das hinzugefügte Lied wiedergegeben."},
    {command: "stop", desc: "**!stop**, im Musik-Channel, stopt die Wiedergabe der Playlist und löscht die Playlist."},
    {command: "skip", desc: "**!skip**, im Musik-Channel, beendet das aktuell wiedergegebene Lied und spielt das nächste in der Playlist"},
    {command: "{zahl1}d{zahl2}", desc: "**!{zahl1}d{zahl2}**, im DSA-Channel, wirft soviele Würfel wie in *{zahl1}* angegeben. Jeder Würfel hat *{zahl2}* Seiten. Die maximale Anzahl an Würfeln sind 99. Bsp.: **!2d20**, wirft zwei 20-seitige Würfel. "},
    {command: "help", desc: "**!help**, zeigt alle verfügbaren Bot-Befehle an."},
    {command: "queue", desc: "**!queue**, im Musik-Channel, zeigt alle vorhandenen Lieder in der Playlist an."},
    {command: "pause", desc: "**!pause**, im Musik-Channel, pausiert das aktuelle Lied in der Playlist."},
    {command: "resume", desc: "**!resume**, im Musik-Channel, spielt das pausierte Lied weiter."}
]
const standardUserRoleID = process.env.STANDARD_USER_ROLE_ID
const rulesID = process.env.RULES_MESSAGE_ID
const dsaMessageId = process.env.DSA_MESSAGE_ID
const dsaChannelID = process.env.DSA_CHANNEL_ID
const musicTextChannelId = process.env.MUSIC_TEXT_CHANNEL_ID
const musicVoiceChannelId = process.env.MUSIC_VOICE_CHANNEL_ID
const notificationChannelID= process.env.NOTIFICATION_CHANNEL_ID
const queue = new Map()
let prevStreamMessage = ""

client.on('ready', async () =>{
    schedule.scheduleJob('*/1 * * * *', async ()=>{
        const stream = await twitch.getStreams({channel: "serania666"})
        if (!stream.data[0]) {
            prevStreamMessage = ""
            return
        }else{
            postStream(stream.data[0])
        }
    })
    let stream = twitter.stream('statuses/filter', {follow: [process.env.TWITTER_USER_ID]})
    stream.on('tweet', async tweet =>{
        let url = `https://twitter.com/${tweet.user.screen_name}/status/${tweet.id_str}`
        if(tweet.user.screen_name != "Seramaru1") return
        try {
            let channel = await client.channels.fetch(notificationChannelID)
            channel.send(url)
        } catch (error) {
            console.log(error)
        }
    })
    console.log('Logged in succesfully!')
})

client.on('messageReactionAdd', async (reaction, user) => {
	if (reaction.partial) {
		try {
			await reaction.fetch();
		} catch (error) {
			console.error('Something went wrong when fetching the message: ', error);
			return;
		}
	}
    if(reaction.emoji.name == "🔥" && reaction.message.id == rulesID){
        const guild = reaction.message.guild;

        const memberWhoReacted = await guild.members.fetch(`${user.id}`);
        memberWhoReacted.roles.add(standardUserRoleID);
    }
    if(reaction.emoji.name == "🔥" && reaction.message.id == dsaMessageId){
        const guild = reaction.message.guild;

        const memberWhoReacted = await guild.members.fetch(`${user.id}`);
        memberWhoReacted.roles.add(dsaUserRoleID);
    }
});

client.on('message',async msg =>{
    if (msg.content.startsWith(botPrefix)) {
        const args = msg.content.slice(botPrefix.length).trim().split(" ")
        const command = args.shift().toLowerCase()
        let link = args.join("").trim()
        if (command.match(new RegExp(/^\d{1,2}d\d+$/))) {
            handleRollDice(msg, command)
        }else{
            switch (command) {
                case botCommands[0].command:
                    handleMusicPlay(msg, link)
                    break
                case botCommands[1].command:
                    handleMusicStop(msg)
                    break
                case botCommands[2].command:
                    handleMusicSkip(msg)
                    break
                case botCommands[4].command:
                    handleHelp(msg)
                    break
                case botCommands[5].command:
                    handleMusicShowQueue(msg)
                    break
                case botCommands[6].command:
                    handleMusicPause(msg)
                    break
                case botCommands[7].command:
                    handleMusicResume(msg)
                    break
                default:
                    msg.channel.send("Kein korrekter Bot-Befehl, tippe !help ein um eine List aller Befehle zubekommen.")
                    break
            }
        }
    }
})

client.login(process.env.BOT_TOKEN)

const rollTheDice = (numberOfDice, numberOfSides) =>{
    let message = "hat "
    for (let dice = 0; dice < numberOfDice; dice++) {
        message += Math.floor(Math.random() * numberOfSides) + 1; 
        message += ", "          
    }
    message = message.slice(0, -2) + " gewürfelt."
    return message
}

const handleRollDice = (msg, command) =>{
    if (msg.channel.id == dsaChannelID) {   
        params = command.toLowerCase().split("d")
        message = rollTheDice(params[0], params[1])
        msg.reply(message)
    }else{
        msg.reply("Du darfst nur im DSA-Channel würfeln.")
    }
}

const handleMusicPlay = async (msg, link) =>{
    const serverQueue = queue.get(msg.guild.id)
    let voiceChannel = msg.member.voice.channel
    if (msg.channel.id != musicTextChannelId) {
        return msg.channel.send("Musikbefehle können nur im Musik-Channel benutzt werden.")
    }
    if (!link || !ytdl.validateURL(link)) {
        return msg.channel.send("Bitte gib einen Youtube-Link an.")
    }
    if (voiceChannel.id != musicVoiceChannelId) {
        return msg.channel.send("Du musst dich im Musik-Voice-Channel befinden, um den Bot zu nutzen.")        
    }
    const songInfo = await ytdl.getInfo(link).catch((error) =>{
        console.error(error)
        msg.channel.send(`Es ist ein Fehler aufgetreten ${error}`)
    })
    if (!songInfo) return
    let song = {
        title: songInfo.videoDetails.title,
        url: songInfo.videoDetails.video_url
    }
    if (!serverQueue) {
        const queueConstructor = {
            txtChannel : msg.channel,
            voiceChannel: voiceChannel,
            connection: null,
            songs: [],
            volume: 10,
            playing: true
        }
        queue.set(msg.guild.id, queueConstructor)
        queueConstructor.songs.push(song)

        try {
            let connection = await voiceChannel.join()
            queueConstructor.connection = connection
            play(msg.guild, queueConstructor.songs[0])
        } catch (error) {
            console.error(error)
            queue.delete(msg.guild.id)
            return msg.channel.send(`Konnte dem Voice-Chat nicht beitreten: ${error}`)
        }
    } else {
        serverQueue.songs.push(song)
        return msg.channel.send(`Der Song ${song.title} wurde der Queue hinzugefügt`)
    }
}

const play = (guild, song) => {
    const serverQueue = queue.get(guild.id)
    if (!song) {
        serverQueue.voiceChannel.leave()
        queue.delete(guild.id)
        return        
    }
    const dispatcher = serverQueue.connection
    .play(ytdl(song.url, {filter: "audioonly"}))
    .on('finish', ()=>{
        serverQueue.songs.shift()
        play(guild, serverQueue.songs[0])
    })
    serverQueue.txtChannel.send(`Spielt jetzt ${serverQueue.songs[0].title}`)
}

const handleMusicStop = msg =>{
    const serverQueue = queue.get(msg.guild.id)
    if (msg.channel.id != musicTextChannelId) {
        return msg.channel.send("Musikbefehle können nur im Musik-Channel benutzt werden.")
    }
    if (msg.member.voice.channel.id != musicVoiceChannelId)
        return msg.channel.send("Du musst dich im Musik-Voice-Channel befinden, um den Bot zu nutzen.")
    serverQueue.songs = []
    serverQueue.connection.dispatcher.end()
}

const handleMusicSkip = msg => {
    const serverQueue = queue.get(msg.guild.id)
    if (msg.channel.id != musicTextChannelId) {
        return msg.channel.send("Musikbefehle können nur im Musik-Channel benutzt werden.")
    }
    if (msg.member.voice.channel.id != musicVoiceChannelId)
        return msg.channel.send("Du musst dich im Musik-Voice-Channel befinden, um den Bot zu nutzen.")
    if (!serverQueue)
        return msg.channel.send("Die Playlist ist leer, es kann nichts geskipt werden.")
    serverQueue.connection.dispatcher.end()
}

const handleHelp = msg => {
    let message = "Hier eine Liste mit allen Bot-Befehlen: \n"
    botCommands.forEach(element => {
        message += element.desc
        message += "\n"
    });
    msg.channel.send(message)
}

const handleMusicShowQueue= msg =>{
    const serverQueue = queue.get(msg.guild.id)
    if (msg.channel.id != musicTextChannelId) {
        return msg.channel.send("Musikbefehle können nur im Musik-Channel benutzt werden.")
    }
    if(!serverQueue || serverQueue.songs.length == 0)
        return msg.channel.send("Die Playlist ist leer.")
    let message = "Lieder in der Playlist: \n"
    serverQueue.songs.forEach(song =>{
        message += song.title + "\n"
    })
    msg.channel.send(message)
}

const handleMusicPause = msg => {
    const serverQueue = queue.get(msg.guild.id)
    if (msg.channel.id != musicTextChannelId) {
        return msg.channel.send("Musikbefehle können nur im Musik-Channel benutzt werden.")
    }
    if (msg.member.voice.channel.id != musicVoiceChannelId)
        return msg.channel.send("Du musst dich im Musik-Voice-Channel befinden, um den Bot zu nutzen.")
    if (!serverQueue.connection.dispatcher.paused) {
        serverQueue.connection.dispatcher.pause()
        return msg.channel.send(`Die Wiedergabe von ${serverQueue.songs[0].title} wurde pausiert.`)
    }
}

const handleMusicResume = msg => {
    const serverQueue = queue.get(msg.guild.id)
    if (msg.channel.id != musicTextChannelId) {
        return msg.channel.send("Musikbefehle können nur im Musik-Channel benutzt werden.")
    }
    if (msg.member.voice.channel.id != musicVoiceChannelId)
        return msg.channel.send("Du musst dich im Musik-Voice-Channel befinden, um den Bot zu nutzen.")
    if (serverQueue.connection.dispatcher.paused) {
        serverQueue.connection.dispatcher.resume()
        return msg.channel.send(`Die Pausierung von ${serverQueue.songs[0].title} wurde beendet.`)
    }
}

const postStream = async stream => {
    let url = `https://www.twitch.tv/${stream.user_name.toLowerCase()}`
    let streamMessage = `Hey @everyone, ${stream.user_name} ist live, ${stream.title}, schaut mal rein ${url}`
    if (streamMessage == prevStreamMessage) {
        return
    }
    try {
        let channel = await client.channels.fetch(notificationChannelID)
        channel.send(streamMessage)
        prevStreamMessage = streamMessage
    } catch (error) {
        console.log(error)
    }
}
