const User = require("../models/User");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const jwt = require('jsonwebtoken');
const sendgrid = require('@sendgrid/mail');
sendgrid.setApiKey(process.env.SENDGRIDAPIKEY);

exports.doesUsernameExist = function(req, res) {
    User.findByUsername(req.body.username).then(() => {
        res.json(true)
    }).catch(() => {
        res.json(false)
    })
}

exports.doesEmailExist = async function(req, res) {
   let emailBool = await User.doesEmailExist(req.body.email)
   res.json(emailBool)
}

//reusable function for multiple routes
exports.sharedProfileData = async function(req, res, next) {
    let isVisitorsProfile = false;
    let isFollowing = false;
    if (req.session.user) {
        isVisitorsProfile = req.profileUser._id.equals(req.session.user._id) //check user profile id against current session user id
       isFollowing = await Follow.isVisitorFollowing(req.profileUser._id, req.visitorId) //check to see if visitor is following user
    } 

    req.isVisitorsProfile = isVisitorsProfile; //makes the true or false value available for the next function in route
    req.isFollowing = isFollowing;
    //retrieve post, follower, and following counts
    let postCountPromise = Post.countPostsByAuthor(req.profileUser._id)
    let followerCountPromise = Follow.countFollowersById(req.profileUser._id)
    let followingCountPromise = Follow.countFollowingById(req.profileUser._id)
    let [postCount, followerCount, followingCount] = await Promise.all([postCountPromise, followerCountPromise, followingCountPromise]) //faster performance, store in variables and get all promises regardless of order before moving on to next
    
    req.postCount = postCount; //set req. values to our custom variables for easy access 
    req.followerCount = followerCount;
    req.followingCount = followingCount; 

    next()
}

exports.mustBeLoggedIn = function(req, res, next) {
    if (req.session.user) {
        next()
    } else {
        req.flash("errors", "You must be logged in to perform that action.");
        req.session.save(function() {
            res.redirect('/');
        })
    }
}

exports.login = function(req, res) {
    let user = new User(req.body); //pass in from data req.body
    user.login().then(function(result) {
        //make each user session data unique & persistent
        req.session.user = {avatar: user.avatar, username: user.data.username, _id: user.data._id}
        req.session.save(function() {
            res.redirect('/') //call this callback function in the meantime while we wait for the database to sync which may take a while
        })
    }).catch(function(err) {
        req.flash('errors', err) //show flash message on screen if login fails
        req.session.save(function() { //use callback function to make sure the function starts while .save is completing
            res.redirect('/')
        })
    })     
}

// API FUNCTIONS BEGIN //
exports.apiMustBeLoggedIn = function(req, res, next) {
    try {
        req.apiUser = jwt.verify(req.body.token, process.env.JWTSECRET)
        next()
    } catch {
        res.json("Sorry, you must provide a valid token.")
    }
}

exports.apiLogin = function(req, res) {
    let user = new User(req.body);
    user.login().then(function(result) {
        res.json(jwt.sign({_id: user.data._id}, process.env.JWTSECRET, {expiresIn: '20m'}))
    }).catch(function(err) {
        res.json("Sorry, your values are not correct.")
    })     
}

exports.apiGetPostsByUsername = async function(req, res) {
    try {
        let authorDoc = await User.findByUsername(req.params.username)
        let posts = await Post.findByAuthorId(authorDoc._id)
        res.json(posts)
    } catch {
        res.json("Sorry, invalid user requested.")
    }
}

// API FUNCTIONS END//

exports.logout = function(req, res) {
    req.session.destroy(function() {
        res.redirect('/'); //use callback function to make sure redirect doesn't wait for the destroy to finish, because the destory may take some time to connect to database
    }); //deletes session cookie with maching id from database
}

exports.register = function(req, res) {
    let user = new User(req.body);
    user.register().then(() => {
        //send email example: add similar object to any other functions where we want to send an e-mail to client
        sendgrid.send({
            to: user.data.email,
            from: 'ourapp@ourapp.com',
            subject: 'Welcome to the Social App!',
            text: 'Congrats on signing up!',
            html: 'Make your first <strong>first</strong> post today!'
        })
        req.session.user = {username: user.data.username, avatar: user.avatar, _id: user.data._id}
        req.session.save(function() {
            res.redirect('/')
        })
    }).catch((regErrors) => {
        regErrors.forEach(function(error) {
            req.flash('regErrors', error)
        })
        req.session.save(function() {
            res.redirect('/')
        })
    }); 
}

exports.home = async function(req, res) {
    if (req.session.user) {
        //fetch feed of posts for current user
        let posts = await Post.getFeed(req.session.user._id); //render list of posts to home page
        res.render('home-dashboard', {posts: posts});
    } else {
        res.render('home-guest', {regErrors: req.flash('regErrors')}); //show flash message if error
    }
} 

exports.ifUserExists = function(req, res, next) {
    User.findByUsername(req.params.username).then((userDocument) => {
        req.profileUser = userDocument;
        next()
    }).catch(() => {
        res.render("404");
    })
}

exports.profilePostsScreen = function(req, res) {
    //view posts by author id
    Post.findByAuthorId(req.profileUser._id).then((posts) => {
        console.log(req.profileUser)
        res.render('profile', {
            title: `Profile for ${req.profileUser.username}`, //pass into template for header.ejs file
            currentPage: "posts",
            posts: posts, 
            profileUsername: req.profileUser.username,
            profileAvatar: req.profileUser.avatar,
            isFollowing: req.isFollowing,
            isVisitorsProfile: req.isVisitorsProfile,
            counts: {postCount: req.postCount, followerCount: req.followerCount, followingCount: req.followingCount}
        });
    }).catch(() => {
        res.render("404")
    })
}

exports.profileFollowersScreen = async function(req, res) {
   try { 
       //populate followers page by users and avatars and pass into template
    let followers = await Follow.getFollowersById(req.profileUser._id)
    res.render('profile-followers', { 
        currentPage: "followers",
        followers: followers,
        profileUsername: req.profileUser.username,
        profileAvatar: req.profileUser.avatar,
        isFollowing: req.isFollowing,
        isVisitorsProfile: req.isVisitorsProfile,
        counts: {postCount: req.postCount, followerCount: req.followerCount, followingCount: req.followingCount}
    })
   } catch {
    res.render("404");
   }
}

exports.profileFollowingScreen = async function(req, res) {
   try { 
       //populate followers page by users and avatars and pass into template
    let following = await Follow.getFollowingById(req.profileUser._id)
    res.render('profile-following', { 
        currentPage: "following",
        following: following,
        profileUsername: req.profileUser.username,
        profileAvatar: req.profileUser.avatar,
        isFollowing: req.isFollowing,
        isVisitorsProfile: req.isVisitorsProfile,
        counts: {postCount: req.postCount, followerCount: req.followerCount, followingCount: req.followingCount}
    })
   } catch {
    res.render("404");
   }
}