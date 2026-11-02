var mongoose = require('mongoose');
const User = require('../models/user.js');
const Task = require('../models/task.js');

module.exports = function (router) {
    const usersRoute = router.route('/users');
    const usersIdRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        let where = {};
        let sort = {};
        let select = {};
        try {
            where = req.query.where ? JSON.parse(req.query.where) : {}; 
            sort = req.query.sort ? JSON.parse(req.query.sort) : {}; 
            select = req.query.select ? JSON.parse(req.query.select) : {}; 
        } catch (e) {
            return res.status(400).json({message: 'Must be a valid JSON.', data: {}});
        }

        const skip = req.query.skip !== undefined ? parseInt(req.query.skip) : 0;
        if (!Number.isInteger(skip) || skip < 0) {
            return res.status(400).json({message: 'Must be a non-negative integer.', data: {}})
        }

        const limit = req.query.limit !== undefined ? parseInt(req.query.limit) : 0;
        if (!Number.isInteger(limit) || limit < 0) {
            return res.status(400).json({message: 'Must be a non-negative integer.', data: {}})
        }

        const count = req.query.count === 'true';
        // Respond with a List of users
        try {
            if (!count) {
                const users = await User.find(where).sort(sort).select(select).skip(skip).limit(limit);
                return res.status(200).json({message: 'Success', data: users});
            }

            const numUsers = await User.countDocuments(where);
            return res.status(200).json({message: 'Success: users GET', data: numUsers});
        } catch (err) {
            if (err.name === 'CastError') {
                return res.status(200).json({message: 'Success', data: count ? 0 : []});
            }
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    usersRoute.post(async function (req, res) {
        if (!req.body.name || typeof req.body.name !== 'string') {
            return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
        }
        if (!req.body.email || typeof req.body.email !== 'string') {
            return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
        }

        let pendingTasks = [];
        if (req.body.pendingTasks !== undefined) {
            if (!Array.isArray(req.body.pendingTasks)) {
                return res.status(400).json({message: 'pendingTasks must be a list.', data: {}}); 
            }
            for (const id of req.body.pendingTasks) {
                if (!mongoose.isValidObjectId(id)) {
                    return res.status(400).json({message: 'pendingTasks is not a valid id format.', data: {}}); 
                }
                if (!pendingTasks.includes(id)) {
                    pendingTasks.push(id);
                }
            }
        }

        try {
            if (await User.exists({email: req.body.email})) {
                return res.status(400).json({message: 'Email already used by another user.', data: {}});
            }

            const currTasks = [];
            let missingTask = false; 
            for (const id of pendingTasks) {
                const t = await Task.findById(id); 
                if (t) {
                    currTasks.push(t)
                } else {
                    missingTask = true;
                }
            }
            if (missingTask) {
                return res.status(404).json({message: 'A task id in pendingTasks is a valid id but no such task exists.', data: {}});
            }
            for (const t of currTasks) {
                if (t.completed) {
                    return res.status(400).json({message: 'A completed task in pendingTasks.', data: {}});
                }
            }
            
            // Create a new user. Respond with details of new user
            const newUser = await User.create({
                name: req.body.name,
                email: req.body.email,
                pendingTasks: pendingTasks
            });

            for (const i of currTasks) {
                // in new but currently assigned to another user -> remove task from the other user's pendingTasks, then assigned to this user
                if (i.assignedUser) {
                    const otherUser = await User.findById(i.assignedUser);
                    if (otherUser) {
                        const out = []; 
                        for (const id of otherUser.pendingTasks) {
                            if (id !== String(i._id)) {
                                out.push(id); 
                            }
                        }
                        otherUser.pendingTasks = out; 
                        await otherUser.save(); 
                    } 
                }
                // in new but not in old -> assigned to this user
                i.assignedUser = String(newUser._id);
                i.assignedUserName = newUser.name;
                await i.save(); 
            }
            return res.status(201).json({message: 'Success: users POST', data: newUser});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    usersIdRoute.get(async function (req, res) {
        // check URL id (404)
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({message: 'User not found.', data: {}});
        }
        // check valid select JSON (400)
        let select = {};
        try {
            select = req.query.select ? JSON.parse(req.query.select): {};
        } catch (e) {
            return res.status(400).json({message: 'Must be a valid JSON.', data: {}});
        }
    
        // Respond with details of specified user or 404 error
        try {
            const user = await User.findById(req.params.id).select(select);
            if (user) {
                return res.status(200).json({message: 'Success: users/:id GET', data: user});
            }
            return res.status(404).json({message: 'User not found.', data: {}});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    usersIdRoute.put(async function (req, res) {
        try {
            // URL id is not an existing resource -> 404 
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(404).json({message: 'User not found.', data: {}});
            }
            const user = await User.findById(req.params.id);
            if (!user) {
                return res.status(404).json({message: 'User not found.', data: {}});
            }

            // Missing/invalid required field or a value of the wrong type -> 400 
            if (!req.body.name || typeof req.body.name !== 'string') {
                return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
            }
            if (!req.body.email || typeof req.body.email !== 'string') {
                return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
            }

            // A task id in pendingTasks is not a valid id format -> 400 
            // Source: https://stackoverflow.com/questions/767486/how-do-i-check-if-a-variable-is-an-array-in-javascript
            // https://www.w3schools.com/jsref/jsref_isarray.asp 
            let pendingTasks = [];
            if (req.body.pendingTasks !== undefined) {
                if (!Array.isArray(req.body.pendingTasks)) {
                    return res.status(400).json({message: 'pendingTasks must be a list.', data: {}}); 
                }
                for (const id of req.body.pendingTasks) {
                    if (!mongoose.isValidObjectId(id)) {
                        return res.status(400).json({message: 'pendingTasks is not a valid id format.', data: {}}); 
                    }
                    if (!pendingTasks.includes(id)) {
                        pendingTasks.push(id);
                    }
                }
            }

            // Email already used by another user -> 400 
            const existingUser = await User.exists({email: req.body.email}); 
            if (existingUser && String(existingUser._id) !== String(user._id)) {
                return res.status(400).json({message: 'Email already used by another user.', data: {}});
            }

            const currTasks = [];
            let missingTask = false; 
            for (const id of pendingTasks) {
                const t = await Task.findById(id); 
                if (t) {
                    currTasks.push(t)
                } else {
                    missingTask = true;
                }
            }
            // A task id in pendingTasks is a valid id but no such task/user exists -> 404
            if (missingTask) {
                return res.status(404).json({message: 'A task id in pendingTasks is a valid id but no such task exists.', data: {}});
            }
            // A completed task in pendingTasks -> 400
            for (const t of currTasks) {
                if (t.completed) {
                    return res.status(400).json({message: 'A completed task in pendingTasks.', data: {}});
                }
            }
            
            // in old but not in new -> unassigned
            for (const id of user.pendingTasks) {
                if (!pendingTasks.includes(id)) {
                    const oldTask = await Task.findById(id);
                    if (!oldTask) {
                        continue;
                    }
                    oldTask.assignedUser = '';
                    oldTask.assignedUserName = 'unassigned';
                    await oldTask.save();
                }
            }

            // in new but currently assigned to another user -> remove task rom the other user's pendingTasks, then assigned to this user
            for (const i of currTasks) {
                if (i.assignedUser && i.assignedUser !== String(user._id)) {
                    const otherUser = await User.findById(i.assignedUser);
                    if (otherUser) {
                        const out = []; 
                        for (const id of otherUser.pendingTasks) {
                            if (id !== String(i._id)) {
                                out.push(id); 
                            }
                        }
                        otherUser.pendingTasks = out; 
                        await otherUser.save(); 
                    }
                }
                // in new but not in old -> assigned to this user
                i.assignedUser = String(user._id);
                i.assignedUserName = user.name;
                await i.save(); 
            }
            // Replace entire user with supplied user 
            user.name = req.body.name;
            user.email = req.body.email;
            user.pendingTasks = pendingTasks; 
            await user.save();

            // already assigned to this user -> stay assigned; if name change, update assignedUserName
            const assignedTask = await Task.find({assignedUser: String(user._id)});
            for (const i of assignedTask) {
                i.assignedUserName = user.name;
                await i.save();
            }
            return res.status(200).json({message: 'Success: users/:id PUT', data: user});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    usersIdRoute.delete(async function (req, res) {
        try {
            // URL id is not an existing resource -> 404 
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(404).json({message: 'User not found.', data: {}});
            }
            const user = await User.findById(req.params.id);
            if (!user) {
                return res.status(404).json({message: 'User not found.', data: {}});
            }

            // Unassigns all of the user's tasks 
            const assignedTask = await Task.find({assignedUser: String(user._id)});
            for (const i of assignedTask) {
                i.assignedUser = '';
                i.assignedUserName = 'unassigned';
                await i.save();
            }
            // Delete specified user 
            // Source: https://www.geeksforgeeks.org/mongodb/mongoose-findbyidanddelete-function/
            await User.findByIdAndDelete(req.params.id);
            
            return res.status(200).json({message: 'Success: users/:id DELETE', data: {}});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    return router;
}