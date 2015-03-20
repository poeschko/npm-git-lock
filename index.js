#!/usr/bin/env node


"use strict";
var git = require("git-promise");
var npmi = require("npmi");
var del = require("del");
var fs = require("fs");
var promisify = require("es6-promisify");
var log = require("loglevel");
var readFilePromise = promisify(fs.readFile);
var npmiPromise = promisify(npmi);
var delPromise = promisify(del);
var statPromise = promisify(fs.stat);

var argv = require("optimist").usage("Usage: $0 --repo [git@bitbucket.org:your/git/repository.git] --folder [relative/path/to/folder/with/node_modules] --verbose").describe("verbose", "Print progress log messages").demand(["repo", "folder"]).argv;

var packageJson = undefined;
var cwd = process.cwd();
if (argv.verbose) {
    log.setLevel("debug");
} else {
    log.setLevel("info");
}
var repo = argv.repo;
var folder = argv.folder;

readFilePromise("" + folder + "/package.json", "utf-8").then(function (packageJsonContent) {
    packageJson = JSON.parse(packageJsonContent);
    log.debug("Read package.json version " + packageJson.version);
    return packageJson;
}).then(function () {
    return statPromise("" + cwd + "/" + folder + "/node_modules").then(function () {
        log.debug("Checking if remote " + repo + " exists");
        process.chdir("" + cwd + "/" + folder + "/node_modules");
        return git("git remote -v").then(function (remoteCommandOutput) {
            if (remoteCommandOutput.indexOf(repo) !== -1) {
                // repo is in remotes, let's pull the required version
                log.debug("Remote existis, pulling master branch");
                return git("git pull " + repo + " master");
            }
            throw "remote does not exist";
        });
    }, function () {
        log.debug("Remote " + repo + " is not present in " + cwd + "/" + folder + "/node_modules/.git repo");
        log.debug("Removing " + cwd + "/" + folder + "/node_modules folder");
        process.chdir("" + cwd + "/" + folder);
        return delPromise(["node_modules/"]).then(function () {
            log.debug("cloning " + repo);
            return git("clone " + repo + " node_modules");
        });
    });
}).then(function () {
    log.debug("" + repo + " is in node_modules folder, checkoing out " + packageJson.version + " tag");
    process.chdir("" + cwd + "/" + folder + "/node_modules");
    return git("reset --hard " + packageJson.version).then(null, installPackagesTagAndPustToRemote);
}).then(function () {
    process.chdir("" + cwd);
    log.info("Node_modules are in sync with " + repo + " " + packageJson.version);
    process.exit(0);
})["catch"](function (error) {
    try {
        process.chdir("" + cwd);
        log.debug("Failed to synchronise node_modules with " + repo + " " + packageJson.version + ": " + error);
        process.exit(1);
    } catch (e) {
        console.error(e);
    }
});

function installPackagesTagAndPustToRemote() {
    log.debug("Requested tag does not exist, remove everything from node_modules and do npm install");
    return delPromise(["**", "!.git/"]).then(function () {
        var options = {
            forceInstall: false
        };
        process.chdir("" + cwd + "/" + folder);
        return npmiPromise(options);
    }).then(function () {
        log.debug("All packages installed");
        process.chdir("" + cwd + "/" + folder + "/node_modules");
        return git("add .");
    }).then(function () {
        return git("commit -a -m \"updated package.json, freezing changes\"");
    }).then(function () {
        log.debug("Committed, adding tag");
        return git("tag " + packageJson.version);
    }).then(function () {
        log.debug("Pushing tag " + packageJson.version + " to " + repo);
        return git("push " + repo + " master --tags");
    });
}
