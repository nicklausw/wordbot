import "reflect-metadata";
import { TextBasedChannel, Intents, Interaction, Message, MessageEmbed } from "discord.js";
import { Client } from "discordx";
import { dirname, importx } from "@discordx/importer";
import { Koa } from "@discordx/koa";
import { exec } from "child_process";
import * as MySQL from "mysql";
import v from "voca";

var dataChanged = false;

var con = MySQL.createConnection({
  host: "127.0.0.1",
  user: "root",
  password: process.env.SQL_PASS
});

function closeConnection() {
  con.end();
  console.log("closed sql connection.");
  process.exit();
}
/*
process.on("SIGINT", closeConnection); // ctrl+c
process.on("SIGUSR1", closeConnection); // nodemon restart
process.on("SIGUSR2", closeConnection); // also nodemon restart
process.on("uncaughtException", closeConnection);
*/
// promise to get the query output.
function query(sql = "", params = Object.create(null)) {
  return new Promise((resolve, reject) => {
    console.log(sql);
    con.query(
      sql,
      params,
      (err, results: any, fields: any) => {
        if (err) { reject(err); } else { resolve({ results, fields }); }
      },
    );
  });
}

// output of queryForResults() depends on two things.
// say your returned variable is named output. to access it, ask...
// 1. how many columns are you asking for? if one: "output". easy.
// if multiple, just use their names like "output.word" and "output.uses".
// 2. how many results do you expect? if one, you won't get an array.
// if multiple, you will, like "output[2].word".

async function queryForResults(thisQuery: string): Promise<any> {
  var result: any = await query(thisQuery);
  var out = new Array<any>();
  var selections = new Array<string>();
  for(var s = 0; s < result["fields"].length; s++) {
    selections.push(result["fields"][s]["name"]);
  }
  for(var c = 0; c < Object.keys(result["results"]).length; c++) {
    var thisSet = new Array<any>();
    for(var d = 0; d < selections.length; d++) {
      if(selections.length === 1) {
        thisSet[c] = result["results"][c][selections[d]];
      } else {
        thisSet[selections[d]] = result["results"][c][selections[d]];
      }
    }
    if(selections.length === 1) {
      out.push(thisSet[c]);
    } else {
      out.push(thisSet);
    }
  }
  if(out.length === 1) {
    return out[0];
  } else {
    return out;
  }
}

function helpMessage(message: Message) {
  const helpEmbed = new MessageEmbed()
  .setTitle(client.user!.username)
  .setDescription('fully case-insensitive.')
  .addFields(
    { name: "favoriteword (person)", value: "gets person's most used word." },
    { name: "wordcount (person) (word)", value: "gets number of times person has used word." },
    { name: "totalwordcount (person)", value: "gets number of words person has used in total" },
    { name: "serverwordcount (word)", value: "gets number of times anyone in server has used word." },
    { name: "servertotalwordcount", value: "gets total number of words used in server." },
    { name: "vocabsize (person)", value: "gets number of unique words person has used" },
    { name: "servervocabsize", value: "gets number of unique words server has used" },
    { name: "addname (person) (name)", value: "add an alias to avoid mentioning someone repeatedly." }
  );

  message.reply({embeds: [helpEmbed]});
}

// get a nickname, or return a numerical ID.
async function resolveName(s: string, db: string, message: Message): Promise<string> {
  s = v.trim(s, "<@!>");
  if(s.length == 17 || s.length == 18) {
    if(parseInt(s) != NaN) {
      // it's a numeric ID already, just return it.
      return s;
    }
  }
  try {
    s = await queryForResults("select id from " + db + " where name=\'" + s + "\';");
  } catch {
    // no one by that name.
    return "";
  }
  return s;
}

// make a string SQL-friendly.
function sqlstring(s: string): string {
  s = s.replace("\'", "\'\'").toLowerCase();
  const allowedSymbols = "abcdefghijklmnopqrstuvwxyz\'";
  var newstring = "";
  for(var c = 0; c < s.length; c++) {
    if(allowedSymbols.includes(s[c])) {
      newstring += s[c];
    }
  }
  newstring = v.trim(newstring, "\'");
  return newstring;
}

async function handleWord(thisword: string, wordTable: string, serverSchema: string) {
  var word = sqlstring(thisword);
  if(word.length > 50 || word === "") {
    return;
  }
  var uses: Number = 1;
  try {
    uses = await queryForResults("select uses from " + serverSchema + wordTable + " where word=\'" + word + "\';") + 1;
  } catch { }

  await query("insert into " + serverSchema + wordTable + " (word, uses) values (" + "\'" + word + "\', " + uses + ") on duplicate key update uses = " + uses + ";");
  dataChanged = true;
}

async function indexChannels(message: Message) {
  if(message.author.id !== "223609896086667264") {
    message.reply("only Nick can do that.");
    return;
  }
  for(var c = 0; c < message.mentions.channels.size; c++) {
    var channel : TextBasedChannel = message.mentions.channels.get(message.mentions.channels.keyAt(c)!)!;
    console.log("indexing " + channel.id + "...");
    var messageList = new Array<Message<boolean>>();
    const messages = await channel.messages.fetch();
    messages.forEach(thisMessage => {
      messageList.push(thisMessage);
    })
    do {
      await newMessage(messageList[0], false);
      messageList.shift();
    } while(messageList[0] !== undefined);
    console.log("indexed " + channel.id + ".");
  }
  console.log("processed message from " + message.author.id + ".");
  return;
}

class FavoriteWord {
  word: string;
  uses: number;
  constructor(word: string, uses: number) {
    this.word = word;
    this.uses = uses;
  }
}

async function getFavoriteWords(server: string, person: string): Promise<Array<FavoriteWord>> {
  var serverSchema: string = "s" + server + ".";
  var thisWordTable: string = serverSchema + "u" + person;
  var words = new Array<FavoriteWord>();
  try {
    var maxUses = await queryForResults("select max(uses) from " + thisWordTable + " where length(word) > 5;");
    var results: any = await queryForResults("select word from " + thisWordTable + " where uses = " + maxUses + " and length(word) > 5;");
    if(Array.isArray(results)) {
      console.log(results);
      for(var c = 0; c < results.length; c++) {
        words.push(new FavoriteWord(results[c], maxUses));
      }
    } else {
      words.push(new FavoriteWord(results, maxUses));
    }
  } catch (error) {
    throw error;
  }
  return words;
}

async function getWordCount(word: string, wordTable: string): Promise<number> {
  try {
    return await queryForResults("select sum(uses) from " + wordTable + " where word like \'%" + word + "%\';");
  } catch {
    return 0;
  }
}

async function getServerWordCount(server: string, word: string): Promise<number> {
  var serverSchema: string = "s" + server + ".";
  var userCount: number;
  var serverWordCount = 0;
  var wordCounts = await queryForResults("select * from " + serverSchema + "users;");

  userCount = await queryForResults("select count(*) from " + serverSchema + "users;");
  for(var c = 0; c < userCount; c++) {
    var thisCount = wordCounts[c];
    serverWordCount += await getWordCount(word, serverSchema + "u" + thisCount);
  }
  return serverWordCount;
}

async function getTotalWordCount(server: string, person: string): Promise<number> {
  try {
    return await queryForResults("select sum(uses) from s" + server + ".u" + person + ";");
  } catch {
    return 0;
  }
}

async function getServerTotalWordCount(server: string): Promise<number> {
  var serverSchema: string = "s" + server + ".";
  var serverTotalWordCount = 0;

  var wordTables: string = await queryForResults("select * from " + serverSchema + "users;");
  var userCount = wordTables.length;
  for(var c = 0; c < userCount; c++) {
    var sum: number = await queryForResults("select sum(uses) from " + serverSchema + "u" + wordTables[c] + ";");
    serverTotalWordCount += sum;
  }
  return serverTotalWordCount;
}

async function getVocabSize(server: string, person: string): Promise<number> {
  var serverSchema: string = "s" + server + ".";
  var thisWordTable: string = serverSchema + "u" + person;
  try {
    return await queryForResults("select count(*) from " + thisWordTable + ";");
  } catch {
    return 0;
  }
}

async function getServerVocabSize(server: string): Promise<number> {
  var serverSchema: string = "s" + server + ".";
  var userList = await queryForResults("select * from " + serverSchema + "users;");
  var userCount = userList.length;
  var joinString = "";
  for(var c = 0; c < userCount; c++) {
    joinString += "select word from " + serverSchema + "u" + userList[c];
    if(c !== userCount - 1) {
      joinString += " union ";
    } else {
      joinString += ";";
    }
  }

  var uniqueWordList: any = await query(joinString);
  return Object.keys(uniqueWordList["results"]).length;
}

async function addName(server: string, person: string, name: string) {
  try {
    await query("insert into s" + server + ".nicknames (name, id) values (" + "\'" + name + "\', " + person + ") on duplicate key update id = " + person + ";");
    dataChanged = true;
  } catch (error) {
    throw error;
  }
  return;
}

async function getNicknames(server: string, id: string): Promise<Array<string>> {
  try {
    return await queryForResults("select name from s" + server + ".nicknames where id = '" + id + "';");
  } catch {
    return new Array<string>();
  }
}

async function funFacts(message: Message) {
  var replyMessage = "Hello, " + message.author.username + "! ";
  var nicknames = await getNicknames(message.guild!.id, message.author.id);
  var favoriteWords = await getFavoriteWords(message.guild!.id, message.author.id);
  var totalWordCount = await getTotalWordCount(message.guild!.id, message.author.id);
  var vocabSize = await getVocabSize(message.guild!.id, message.author.id);
  var serverTotalWordCount = await getServerTotalWordCount(message.guild!.id);
  var serverVocabSize = await getServerVocabSize(message.guild!.id);

  // point out nicknames that aren't username
  var freshNames = new Array<string>();
  for(var c = 0; c < nicknames.length; c++) {
    if(nicknames[c] !== message.author.username.toLowerCase()) {
      freshNames.push(nicknames[c]);
    }
  }
  if(freshNames.length > 0) {
    replyMessage += "I also know you as ";
    for(var c = 0; c < freshNames.length; c++) {
      replyMessage += freshNames[c];
      if(c === freshNames.length - 1) {
        replyMessage += ".\n";
      } else if(c !== freshNames.length - 2) {
        replyMessage += ", ";
      } else {
        replyMessage += " and ";
      }
    }
  }
  if(favoriteWords.length === 0) {
    replyMessage += "I haven't registered any messages from you. What's up with that? You type such beautiful words.\n";
  } else if(favoriteWords.length === 1) {
    replyMessage += "You must like the word \"" + favoriteWords[0].word + "\" a lot. You've used it more than any other, " + favoriteWords[0].uses + " time" + (favoriteWords[0].uses !== 1 ? "s" : "") + "!\n";
  } else {
    replyMessage += "You must like the words ";
    for(var c = 0; c < favoriteWords.length; c++) {
      replyMessage += "\"" + freshNames[c] + "\"";
      if(c === freshNames.length - 1) {
        replyMessage += ". You've used them more than any other, " + favoriteWords[0].uses + " time" + (favoriteWords[0].uses !== 1 ? "s" : "") + " each!\n";
      } else if(c !== freshNames.length - 2) {
        replyMessage += ", ";
      } else {
        replyMessage += " and ";
      }
    }
  }
  replyMessage += "From what I've counted in this server, your total word count is " + totalWordCount + " word" + (totalWordCount !== 1 ? "s" : "") + ". ";
  replyMessage += vocabSize + " of them are unique.\n";
  replyMessage += "Your words make up " + Math.round((totalWordCount / serverTotalWordCount) * 100) + "% of those on this server.\n";
  replyMessage += "You've also used " + Math.round((totalWordCount / serverTotalWordCount) * 100) + "% of the unique words on this server.\n";
  replyMessage += "Your lucky number today is " + Math.round(Math.random() * 10) + ". Cherish that.\nHave a nice day/night/whatever!";
  message.reply(replyMessage);
}


async function handleMessage(message: Message, runCommands: boolean) {
  var serverSchema: string = "s" + message.guild!.id + ".";
  var parameters: Array<string> = message.content.toLowerCase().split(" ");

  if(runCommands) console.log("processing message from " + message.author.id + "...");

  if(message.content.toLowerCase().startsWith("indexchannels") && runCommands) {
    await indexChannels(message);
    return;
  }

  if(message.content.toLowerCase().startsWith("favoriteword") && runCommands) {
    if(parameters.length !== 2) {
      helpMessage(message);
      return;
    }
    var person = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person == "") {
      await message.reply("I don't know anyone by that name.");
      return;
    }
    var favoriteWords = await getFavoriteWords(message.guild!.id, person);
    var maxUses = favoriteWords[0].uses;
    if(favoriteWords.length === 0) {
      message.reply("No words registered. Lurk less.");
    } else if(favoriteWords.length === 1) {
      message.reply("Favorite word is \"" + favoriteWords[0].word + "\" with " + maxUses + " uses.");
    } else {
      var response: string = "Favorite words are ";
      for(var c = 0; c < favoriteWords.length; c++) {
        response += "\"" + favoriteWords[c].word + "\"";
        if(c === favoriteWords.length - 2) response += " and ";
        else if(c !== favoriteWords.length - 1) response += ", ";
      }
      response += " with " + maxUses + " use" + (maxUses !== 1 ? "s" : "") + ".";
      message.reply(response);
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("wordcount") && runCommands) {
    if(parameters.length != 3) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var word: string = parameters[2].replace("\'", "\'\'");
    var thisWordTable: string = serverSchema + "u" + person;
    var count = await getWordCount(word, thisWordTable);
    if(count > 0) {
      message.reply("User has said \"" + word + "\" " + count + " time" + (count !== 1 ? "s" : "") + ".");
    } else {
      message.reply("came up empty on that one.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("serverwordcount") && runCommands) {
    if(parameters.length != 2) {
      helpMessage(message);
      return;
    }
    var word: string = parameters[1].replace("\'", "\'\'");
    var serverWordCount = await getServerWordCount(message.guild!.id, word);
    if(serverWordCount > 0) {
      message.reply("Server has said " + word + " " + serverWordCount + " times.");
    } else {
      message.reply("Server hasn't said that word.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("totalwordcount") && runCommands) {
    if(parameters.length != 2) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var thisWordTable: string = serverSchema + "u" + person;
    var totalWordCount = await getTotalWordCount(message.guild!.id, person);
    if(totalWordCount > 0) {
      message.reply("User has said " + totalWordCount + " words that I've counted.");
    } else {
      message.reply("user hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase() == "servertotalwordcount" && runCommands) {
    var serverTotalWordCount = await getServerTotalWordCount(message.guild!.id);
    if(serverTotalWordCount > 0) {
      message.reply("Server has said " + serverTotalWordCount + " total words.");
    } else {
      message.reply("Server hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("vocabsize") && runCommands) {
    if(parameters.length != 2) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var vocabSize = await getVocabSize(message.guild!.id, person);
    if(vocabSize > 0) {
      message.reply("User has said " + vocabSize + " different words.");
    } else {
      message.reply("User hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase() === "servervocabsize" && runCommands) {
    var serverVocabSize = await getServerVocabSize(message.guild!.id);
    if(serverVocabSize > 0) {
      message.reply("Server has said " + serverVocabSize + " different words.");
    } else {
      message.reply("Server hasn't said anything.");
    }
    return;
  }

  if(message.content.toLowerCase().startsWith("addname") && runCommands) {
    if(parameters.length != 3) {
      helpMessage(message);
      return;
    }
    var person: string = await resolveName(parameters[1], serverSchema + "nicknames", message);
    if(person === "") return;
    var nickname: string = parameters[2].replace("\'", "\'\'");
    var thisNameTable: string = serverSchema + "nicknames";

    if(nickname.toLowerCase() !== sqlstring(nickname)) {
      message.reply("nicknames can only have letters and apostrophes.");
      return;
    }
    nickname = sqlstring(nickname);

    if(nickname.length > 50) {
      message.reply("nicknames can't be longer than 50 characters.");
      return;
    }

    await addName(message.guild!.id, person, nickname);
    return;
  }

  if(message.content.toLowerCase() === "funfacts") {
    await funFacts(message);
    return;
  }

  if(message.content.toLowerCase() === "bitchbothelp") {
    helpMessage(message);
    return;
  }

  var wordTable: string = "u" + message.author.id;

  // make tables for user
  await query("insert into " + serverSchema + "users (id) select \'" + message.author.id + "\' from dual where not exists (select id from " + serverSchema + "users where id=\'" + message.author.id + "\');");
  await query("create table if not exists " + serverSchema + wordTable + "(word varchar(50), uses bigint, primary key(word));");

  var words: Array<string> = message.content.trim().replace("\n", " ").split(" ");
  do {
    await handleWord(words[0], wordTable, serverSchema);
    words.shift();
  } while(words[0] !== undefined)

  if(runCommands) console.log("processed message from " + message.author.id + ".");
}

async function newMessage(message: Message, runCommands: boolean) {
  await query("create schema if not exists s" + message.guild!.id + ";");
  await query("create table if not exists s" + message.guild!.id + ".users(id varchar(50));");
  await query("create table if not exists s" + message.guild!.id + ".nicknames(name varchar(50), id varchar(50), primary key(name));");
  await handleMessage(message, runCommands);
}

export const client = new Client({
 simpleCommand: {
    prefix: "!",
  },
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MEMBERS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS,
    Intents.FLAGS.GUILD_VOICE_STATES,
  ],
  // If you only want to use global commands only, comment this line
  botGuilds: [(client) => client.guilds.cache.map((guild) => guild.id)],
});

client.once("ready", async () => {
  // make sure all guilds are in cache
  await client.guilds.fetch();

  // init all application commands
  await client.initApplicationCommands({
    guild: { log: true },
    global: { log: true },
  });

  // init permissions; enabled log to see changes
  await client.initApplicationPermissions(true);

  // uncomment this line to clear all guild commands,
  // useful when moving to global commands from guild commands
  //  await client.clearApplicationCommands(
  //    ...client.guilds.cache.map((g) => g.id)
  //  );

  console.log("Bot started");

  con.connect(function(err: any) {
    if (err) throw err;
  });

  console.log("MySQL started");
});

client.on("interactionCreate", (interaction: Interaction) => {
  client.executeInteraction(interaction);
});

client.on("messageCreate", (message: Message) => {
  if(message.author.id === client.user!.id) return;

  newMessage(message, true);
});

async function run() {
  // with cjs
  // await importx(__dirname + "/{events,commands}/**/*.{ts,js}");
  // with ems
  await importx(
    dirname(import.meta.url) + "/{events,commands,api}/**/*.{ts,js}"
  );

  // let's start the bot
  if (!process.env.BITCHBOT_TOKEN) {
    throw Error("Could not find BITCHBOT_TOKEN in your environment");
  }
  await client.login(process.env.BITCHBOT_TOKEN); // provide your bot token

  // ************* rest api section: start **********

  // api: preare server
  const server = new Koa();

  // api: need to build the api server first
  await server.build();

  // api: let's start the server now
  const port = process.env.PORT ?? 3000;
  server.listen(port, () => {
    console.log(`discord api server started on ${port}`);
    console.log(`visit localhost:${port}/guilds`);
  });

  // ************* rest api section: end **********
}


async function execAsync(command: string) {
  return new Promise<void>((resolve) => {
    exec(command, (stdout, stderr) => {
      if(stdout) console.log(stdout);
      if(stderr) console.log(stderr);
      resolve();
    })
  })
}

async function exportSQL() {
  if(dataChanged === true) {
    dataChanged = false;
    console.log("exporting to dump.sql...");
    await execAsync("mysqldump --all-databases -u root -p --password=" + process.env.SQL_PASS + " >dump.sql");
    console.log("exported to dump.sql.");
  }
}


if(process.argv.length === 3) {
  if(process.argv[2] === "export") {
    dataChanged = true;
    await exportSQL();
    process.exit();
  }
}

setInterval(exportSQL, 60 * 1000);
run();
