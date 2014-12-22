/**
 * Module dependencies.
 */

var mongoose = require('mongoose');
var http = require('http');
var express = require('express');
var passport = require('passport');
var routes = require('./routes');
var controller = require('./controller');
var path = require('path');
var config = require('./config')[process.env.ENVAR || 'dev'];
var twitter = require('ntwitter');
var fs = require('fs');
var cpuCount = require('os').cpus().length;
var cluster = require('cluster');
var ioe = require('socket.io-emitter')({ host: '127.0.0.1', port: 6379 });
var sticky = require('sticky-session');

var twit = new twitter({
    consumer_key: config.consumer_key,
    consumer_secret: config.consumer_secret,
    access_token_key: config.ac_key,
    access_token_secret: config.ac_secret
});

mongoose.connect(config.db);

var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var redis = require('socket.io-redis');
io.adapter(redis({ host: 'localhost', port: 6379 }));

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.use(express.compress());
app.use(express.favicon());
app.use(express.cookieParser());
app.use(express.session({ secret: config.session_secret }));
app.use(passport.initialize());
app.use(passport.session());
app.use(express.logger('dev'));
app.use(express.bodyParser());
app.use(express.methodOverride());

app.use(function (req, res, next) {
    res.header("X-powered-by", "The Force")
    next()
})
app.use(app.router);
app.use(express.static(path.join(__dirname, 'public'),{ maxAge: 2629800000 }));


//Routes
app.get('/', routes.index);

app.get('/tweet/:msg', routes.tweet)

app.get('/save/:longurl', function(req, res){
    controller.saveState(req.params.longurl, function(err, id){
        res.send(id);
    })
})

app.get('/sm/:shorturl', function(req, res){
    controller.findState(req.params.shorturl, function(err, longUrl){
        res.redirect('/#'+longUrl);
    })
})

app.get('/:room', function(req, res){

    var room  = req.params.room
    res.render('index',{ title: 'MMODM-'+room, user: req.user, room:room })
})

app.get('/auth/twitter',
passport.authenticate('twitter'),
routes.auth);

app.get('/auth/twitter/callback',
passport.authenticate('twitter', { failureRedirect: '/login' }),
routes.auth_cb);

app.get('/logout', routes.logout);

//Socket.io & Twitter Stream API
var users = []
io.on('connection', function (socket) {
    users.push(socket);
});

//Middlewear
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) { return next(); }
    res.redirect('/')
}

function emitKeys(users,keystrokes, room){
    if(users.length >= 0){
        users.forEach(function(s, i, arr){
            s.emit('keys', {keys:keystrokes,room:room});
        })
    }
}

sticky(http).listen(app.get('port'), function(){
    console.log('[' + process.pid + '] running MMODM server on port ' + app.get('port') +' with '+cpuCount+' horsemen');
})

if (cluster.isMaster) {

    var watch = ['#MMODM'];

    twit.verifyCredentials(function (err, data) {
        if(err) console.error(err);
    })
    .stream('statuses/filter', {track:watch}, function(stream) {
        console.log("Twitter Stream API, listening.");
        stream.on('data', function (data) {
            if (data.text !== undefined) {
                var name = data.user.screen_name;
                var tweet_txt = data.text.split("#");
                var ma = false
                if(tweet_txt[0] != null) ma = tweet_txt[0].match(/\[.*\]/);
                if (ma){
                    var m = ma[0].split("");
                    var keystrokes = m.splice(1,m.length-1);
                    for (var i=1; i < tweet_txt.length; i++){
                        if("#"+tweet_txt[i] != watch[0]) if(tweet_txt.length == 2) ioe.emit('keys', {keys:keystrokes,room:tweet_txt[i]});
                }
                if(tweet_txt.length == 2) ioe.emit('keys', {keys:keystrokes,room:"MMODM"});
                        var tweet = {};
                        tweet.handler = name;
                        tweet.beat = keystrokes;
                        tweet.msg = tweet_txt[0];
                        controller.insert(tweet);
                }
                else console.log("Dump.")
            }
        });
        stream.on('error', function (err, code) {
            console.error("err: "+err+" "+code)
        });
    });
}
