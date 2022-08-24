import {DB_URL} from './config.js';
import {MongoClient} from 'mongodb';
var mongo;

// Check if mongodb is connected or not
const isDbConnected = () => !!mongo && !!mongo.topology && mongo.topology.isConnected()

// Connect to mongodb
const connectDb = async() => {
    if(!isDbConnected()){
        try{
            mongo = await MongoClient.connect(DB_URL, {useNewUrlParser: true, useUnifiedTopology: true});
            console.log('Connected to Database!');
        }catch(e){
            console.log('Failed to connected to Database!');
        }
    }
}
// connectDb();

const manageUsers = async(data, action) => {
    await connectDb();
    try{
        const db = mongo.db('AS_TRACKER');
        const users = db.collection('users');
        switch(action){
            case 'read':
                const result = await users.find(data).toArray();
                return {ok: true, result};
            case 'update':
                await users.updateOne({id: data.id}, {$set: data}, {upsert: true});
                return {ok: true}
            case 'delete':
                await users.deleteOne({id: data.id});
                return {ok: true}
            default:
                return {ok: false}
        }
    }catch(e){
        console.log(e);
    }
}

const addToSet = (data) => {
    if(Array.isArray(data.users)) 
        return({$addToSet: { users: {$each: data.users}}})
    else    
        return({$exists: false}, {$addToSet: { users: data.users}})
}

const manageProducts = async(data, action) => {
    await connectDb();
    try{
        console.log(data.userId)
        const db = mongo.db('TESTS');
        const collection = db.collection('tasks');
        switch(action) {
            case 'delete':
                await collection.updateOne(
                  { users: {userId: data.userId, tracking_id: data.tracking_id } },
                  { $pull: { users : {userId: data.userId, tracking_id: data.tracking_id } }, }
                );
                return {ok: true}
            case 'update':
                await collection.updateOne(
                    { link: data.link },
                    [
                        { $set: {
                            link: data.link, merchant: data.merchant, initPrice: data.initPrice, price: data.price, title: data.title,
                            users: {$concatArrays: [
                                {$ifNull: ["$users", []]},
                                {$filter: {
                                    input: data.users || [{userId: data.userId, tracking_id: data.tracking_id }],
                                    cond: {$not: {$in: ['$$this.userId', {$ifNull: ["$users.userId", []]}]}}
                                }}
                            ]}
                        }},
                    ],
                    { upsert: true }
                );
                return {ok: true, tracking_id: data.tracking_id}
            case 'read':
                const result = await collection.find(data).toArray();
                return {ok:true, result};
            default:
                return {ok: false}
        }
    }catch(e){
        console.log(e);
        return {ok: false}
    }
}

// manageProducts({}, 'read').then(data => {
//     console.log(data);
//     fs.writeFileSync('products.json', JSON.stringify(data.result));
// }).catch(e => {
// })

export {manageProducts, manageUsers};