var mongoose = require('mongoose');
const User = require('../models/user.js');
const Task = require('../models/task.js');

module.exports = function (router) {
    const tasksRoute = router.route('/tasks');
    const tasksIdRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
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

        const limit = req.query.limit !== undefined ? parseInt(req.query.limit) : 100;
        if (!Number.isInteger(limit) || limit < 0) {
            return res.status(400).json({message: 'Must be a non-negative integer.', data: {}})
        }

        const count = req.query.count === 'true';

        // Respond with a List of tasks
        try {
            if (!count) {
                const tasks = await Task.find(where).sort(sort).select(select).skip(skip).limit(limit);
                return res.status(200).json({message: 'Success', data: tasks});
            }

            const numTasks = await Task.countDocuments(where);
            return res.status(200).json({message: 'Success: tasks GET', data: numTasks});
        } catch (err) {
            if (err.name === 'CastError') {
                return res.status(200).json({message: 'Success', data: count ? 0 : []});
            }
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    tasksRoute.post(async function (req, res) {
        // Source: https://stackoverflow.com/questions/1353684/detecting-an-invalid-date-date-instance-in-javascript
        // https://www.geeksforgeeks.org/javascript/how-to-check-a-date-is-valid-or-not-using-javascript/ 
        if (!req.body.name || typeof req.body.name !== 'string') {
            return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
        }
        if (!req.body.deadline || isNaN(new Date(req.body.deadline).getTime())) {
            return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
        }

        // A user id in assignedUser is not a valid id format -> 400
        let assignedUser = '';
        if (req.body.assignedUser !== undefined) {
            // unassigned id 
            assignedUser = req.body.assignedUser; 
        }
        if (assignedUser !== '') {
            // malformed id 
            if (!mongoose.isValidObjectId(assignedUser)) {
                return res.status(400).json({message: 'assignedUser is not a valid id format.', data: {}});
            }
        }

        try {
            // A user id in assignedUser is a valid id but no such user exists -> 404
            let assignedUserName = 'unassigned';
            let user = null; 
            if (assignedUser !== '') {
                user = await User.findOne({_id: assignedUser});
                if (!user) {
                    return res.status(404).json({message: 'assignedUser is a valid id but no such user exists.', data: {}});
                }

                // assignedUserName does not match the name of the user assignedUser -> 400
                if (req.body.assignedUserName !== undefined && req.body.assignedUserName !== user.name) {
                    return res.status(400).json({message: 'assignedUserName does not match the name of the user assignedUser.', data: {}});
                }
                assignedUserName = user.name;
            }
            
            // Create a new task. Respond with details of new task
            const newTask = await Task.create({
                name: req.body.name, 
                description: req.body.description,
                deadline: req.body.deadline,
                completed: req.body.completed,
                assignedUser: assignedUser,
                assignedUserName: assignedUserName
            }); 

            // If the task is assigned, it is added to that user's pendingTasks 
            // A completed task is removed from the user's pendingTasks but stays assigned to the user.
            if (user) {
                const out = [];
                for (const id of user.pendingTasks) {
                    if (id !== String(newTask._id)) {
                        out.push(id); 
                    }
                }
                if (!newTask.completed) {
                    out.push(String(newTask._id));
                }
                user.pendingTasks = out; 
                await user.save();
            }

            return res.status(201).json({message: 'Success: tasks POST', data: newTask});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    tasksIdRoute.get(async function (req, res) {
        // check URL id (404)
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(404).json({message: 'Task not found.', data: {}});
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
            const task = await Task.findOne({_id: req.params.id}).select(select);
            if (task) {
                return res.status(200).json({message: 'Success: tasks/:id GET', data: task});
            }
            return res.status(404).json({message: 'Task not found.', data: {}});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    tasksIdRoute.put(async function (req, res) {
        try {
            // URL id is not an existing resource -> 404 
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(404).json({message: 'Task not found.', data: {}});
            }
            const task = await Task.findOne({_id: req.params.id});
            if (!task) {
                return res.status(404).json({message: 'Task not found.', data: {}});
            }

            // Missing/invalid required field or a value of the wrong type -> 400 
            if (!req.body.name || typeof req.body.name !== 'string') {
                return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
            }
            if (!req.body.deadline || isNaN(new Date(req.body.deadline).getTime())) {
                return res.status(400).json({message: 'Missing or invalid field or a value of the wrong type.', data: {}});
            }
            // A user id in assignedUser is not a valid id format -> 400
            let assignedUser = '';
            if (req.body.assignedUser !== undefined) {
                // unassigned id 
                assignedUser = req.body.assignedUser; 
            }
            if (assignedUser !== '') {
                // malformed id 
                if (!mongoose.isValidObjectId(assignedUser)) {
                    return res.status(400).json({message: 'assignedUser is not a valid id format.', data: {}});
                }
            }
            // A user id in assignedUser is a valid id but no such user exists -> 404
            let assignedUserName = 'unassigned';
            let user = null; 
            if (assignedUser !== '') {
                user = await User.findOne({_id: assignedUser});
                if (!user) {
                    return res.status(404).json({message: 'assignedUser is a valid id but no such user exists.', data: {}});
                }

                // assignedUserName does not match the name of the user assignedUser -> 400
                if (req.body.assignedUserName !== undefined && req.body.assignedUserName !== user.name) {
                    return res.status(400).json({message: 'assignedUserName does not match the name of the user assignedUser.', data: {}});
                }
                assignedUserName = user.name;
            }

            // If the task is assigned and not completed, it is added to that user's pendingTasks 
            // If the task is assigned and completed, remove task from the user's pendingTasks but stays assigned to the user.
            let completed = false;
            if (req.body.completed ===true) { completed = true; } 
            if (user) {
                const out = [];
                for (const id of user.pendingTasks) {
                    if (id !== String(task._id)) {
                        out.push(id); 
                    }
                }
                if (!completed) {
                    // added to the user's pendingTasks
                    out.push(String(task._id));
                }
                user.pendingTasks = out; 
                await user.save();
            }

            // If assignedUser changed, the task is removed from the previous user's pendingTasks.
            if (task.assignedUser && task.assignedUser !== assignedUser) {
                const prevUser = await User.findOne({_id: task.assignedUser});
                if (prevUser) {
                    const out = []; 
                    for (const id of prevUser.pendingTasks) {
                        if (id !== String(task._id)) {
                            out.push(id); 
                        }
                    }
                    prevUser.pendingTasks = out; 
                    await prevUser.save(); 
                }
            }

            // Replace entire task with supplied task 
            task.name = req.body.name;
            task.description = (req.body.description || '');
            task.deadline = req.body.deadline;
            task.completed = completed;
            task.assignedUser = assignedUser;
            task.assignedUserName = assignedUserName;
            await task.save();

            return res.status(200).json({message: 'Success: tasks/:id PUT', data: task});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    tasksIdRoute.delete(async function (req, res) {
        try {
            // URL id is not an existing resource -> 404 
            if (!mongoose.isValidObjectId(req.params.id)) {
                return res.status(404).json({message: 'Task not found.', data: {}});
            }
            const task = await Task.findOne({_id: req.params.id});
            if (!task) {
                return res.status(404).json({message: 'Task not found.', data: {}});
            }

            // Removes the task from its assigned user's pendingTasks
            // Delete specified task
            if (task.assignedUser) {
                const user = await User.findOne({_id: task.assignedUser});
                if (user) {
                    const out = [];
                    for (const id of user.pendingTasks) {
                        if (id !== String(task._id)) {
                            out.push(id); 
                        }
                    }
                    user.pendingTasks = out; 
                    await user.save();
                }
            }
            await Task.findByIdAndDelete(req.params.id);
            return res.status(200).json({message: 'Success: tasks/:id DELETE', data: {}});
        } catch (err) {
            return res.status(500).json({message: 'Server error', data: {}});
        }
    });

    return router;
}