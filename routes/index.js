const utils = require('../utils');

// Importar módulos externos
const mongoose = require('mongoose');
const hms = require('humanize-ms');
const ms = require('ms');
const streamBuffers = require('stream-buffers');
const readline = require('readline');
const moment = require('moment');
const { exec } = require('child_process');
const validator = require('validator');
const fileType = require('file-type');
const AdmZip = require('adm-zip');
const fs = require('fs');
const _ = require('lodash');

// Modelos de Mongoose
const Todo = mongoose.model('Todo');
const User = mongoose.model('User');

// Exportar funciones del módulo
exports.index = function (req, res, next) {
  Todo.find({})
    .sort('-updated_at')
    .exec((err, todos) => {
      if (err) return next(err);
      res.render('index', {
        title: 'Patch TODO List',
        subhead: 'Vulnerabilities at their best',
        todos: todos,
      });
    });
};

exports.loginHandler = function (req, res, next) {
  if (validator.isEmail(req.body.username)) {
    User.find({ username: req.body.username, password: req.body.password }, (err, users) => {
      if (err) return next(err);
      if (users.length > 0) {
        const redirectPage = req.body.redirectPage;
        const session = req.session;
        const username = req.body.username;
        return adminLoginSuccess(redirectPage, session, username, res);
      } else {
        return res.status(401).send();
      }
    });
  } else {
    return res.status(401).send();
  }
};

function adminLoginSuccess(redirectPage, session, username, res) {
  session.loggedIn = 1;
  console.log(`User logged in: ${username}`);
  if (redirectPage) {
    return res.redirect(redirectPage);
  } else {
    return res.redirect('/admin');
  }
}

exports.login = function (req, res, next) {
  return res.render('admin', {
    title: 'Admin Access',
    granted: false,
    redirectPage: req.query.redirectPage,
  });
};

exports.admin = function (req, res, next) {
  return res.render('admin', {
    title: 'Admin Access Granted',
    granted: true,
  });
};

exports.get_account_details = function(req, res, next) {
  const profile = {};
  return res.render('account.hbs', profile);
};

exports.save_account_details = function(req, res, next) {
  const profile = req.body;
  if (validator.isEmail(profile.email, { allow_display_name: true }) &&
      validator.isMobilePhone(profile.phone, 'he-IL') &&
      validator.isAscii(profile.firstname) &&
      validator.isAscii(profile.lastname) &&
      validator.isAscii(profile.country)) {
    profile.firstname = validator.rtrim(profile.firstname);
    profile.lastname = validator.rtrim(profile.lastname);
    return res.render('account.hbs', profile);
  } else {
    console.log('Error in form details');
    return res.render('account.hbs');
  }
};

exports.isLoggedIn = function (req, res, next) {
  if (req.session.loggedIn === 1) {
    return next();
  } else {
    return res.redirect('/');
  }
};

exports.logout = function (req, res, next) {
  req.session.loggedIn = 0;
  req.session.destroy(() => {
    return res.redirect('/');
  });
};

function parse(todo) {
  let t = todo;
  const remindToken = ' in ';
  const reminder = t.toString().indexOf(remindToken);
  if (reminder > 0) {
    let time = t.slice(reminder + remindToken.length).replace(/\n$/, '');
    const period = hms(time);
    console.log('period: ' + period);
    t = t.slice(0, reminder);
    if (period !== undefined) {
      t += ' [' + ms(period) + ']';
    }
  }
  return t;
}

exports.create = function (req, res, next) {
  const item = req.body.content;
  const imgRegex = /\!\[alt text\]\((http.*)\s\".*/;
  if (typeof item === 'string' && item.match(imgRegex)) {
    const url = item.match(imgRegex)[1];
    console.log('found img: ' + url);
    exec('identify ' + url, (err, stdout, stderr) => {
      if (err !== null) {
        console.log('Error (' + err + '):' + stderr);
      }
    });
  } else {
    item = parse(item);
  }
  new Todo({
    content: item,
    updated_at: Date.now(),
  }).save((err, todo) => {
    if (err) return next(err);
    res.setHeader('Location', '/');
    res.status(302).send(todo.content.toString('base64'));
  });
};

exports.destroy = function (req, res, next) {
  Todo.findById(req.params.id, (err, todo) => {
    if (err) return next(err);
    todo.remove((err) => {
      if (err) return next(err);
      res.redirect('/');
    });
  });
};

exports.edit = function (req, res, next) {
  Todo.find({})
    .sort('-updated_at')
    .exec((err, todos) => {
      if (err) return next(err);
      res.render('edit', {
        title: 'TODO',
        todos: todos,
        current: req.params.id,
      });
    });
};

exports.update = function (req, res, next) {
  Todo.findById(req.params.id, (err, todo) => {
    if (err) return next(err);
    todo.content = req.body.content;
    todo.updated_at = Date.now();
    todo.save((err) => {
      if (err) return next(err);
      res.redirect('/');
    });
  });
};

exports.current_user = function (req, res, next) {
  next();
};

function isBlank(str) {
  return (!str || /^\s*$/.test(str));
}

exports.import = function (req, res, next) {
  if (!req.files) {
    res.send('No files were uploaded.');
    return;
  }

  const importFile = req.files.importFile;
  let data;

  let importedFileType = fileType(importFile.data);
  const zipFileExt = { ext: "zip", mime: "application/zip" };

  if (importedFileType === null) {
    importedFileType = { ext: "txt", mime: "text/plain" };
  }

  if (importedFileType.mime === zipFileExt.mime) {
    const zip = new AdmZip(importFile.data);
    const extracted_path = "/tmp/extracted_files";
    zip.extractAllTo(extracted_path, true);
    data = "No backup.txt file found";
    fs.readFile('backup.txt', 'ascii', (err, fileData) => {
      if (!err) {
        data = fileData;
      }
    });
  } else {
    data = importFile.data.toString('ascii');
  }

  const lines = data.split('\n');
  lines.forEach((line) => {
    const parts = line.split(',');
    const what = parts[0];
    console.log('importing ' + what);
    const when = parts[1];
    const locale = parts[2];
    const format = parts[3];
    let item = what;

    if (!isBlank(what)) {
      if (!isBlank(when) && !isBlank(locale) && !isBlank(format)) {
        console.log('setting locale ' + parts[1]);
        moment.locale(locale);
        const d = moment(when);
        console.log('formatting ' + d);
        item += ' [' + d.format(format) + ']';
      }

      new Todo({
        content: item,
        updated_at: Date.now(),
      }).save((err, todo) => {
        if (err) return next(err);
        console.log('added ' + todo);
      });
    }
  });

  res.redirect('/');
};

exports.about_new = function (req, res, next) {
  console.log(JSON.stringify(req.query));
  return res.render("about_new.dust", {
    title: 'Patch TODO List',
    subhead: 'Vulnerabilities at their best',
    device: req.query.device,
  });
};

const users = [
  { name: 'user', password: 'pwd' },
  { name: 'admin', password: Math.random().toString(32), canDelete: true },
];

let messages = [];
let lastId = 1;

function findUser(auth) {
  return users.find((u) => u.name === auth.name && u.password === auth.password);
}

exports.chat = {
  get(req, res) {
    res.send(messages);
  },
  add(req, res) {
    const user = findUser(req.body.auth || {});
    if (!user) {
      res.status(403).send({ ok: false, error: 'Access denied' });
      return;
    }

    const message = { icon: '👋' };
    _.merge(message, req.body.message, {
      id: lastId++,
      timestamp: Date.now(),
      userName: user.name,
    });

    messages.push(message);
    res.send({ ok: true });
  },
  delete(req, res)
