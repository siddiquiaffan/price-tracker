import {manageProducts} from './db.js'
import { productCommonUrl } from './utils.js'
import fs from 'fs'
import { DB_URL } from "./config.js";
import { MongoClient } from "mongodb";
var mongo;

// Check if mongodb is connected or not
const isDbConnected = () =>
  !!mongo && !!mongo.topology && mongo.topology.isConnected();

// Connect to mongodb
const connectDb = async () => {
  if (!isDbConnected()) {
    try {
      mongo = await MongoClient.connect(DB_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      });
      console.log("Connected to Database!");
    } catch (e) {
      console.log("Failed to connected to Database!");
    }
  }
};


const func = async () => {
  await connectDb();
  const collection = mongo.db("AS_TRACKER").collection("tasks");
  const result = await collection.find({}).toArray();
  console.log(result[0].users.length);
  let count = 0;
  result.map((item) => {
    count += item.users.length
  });

  console.log(count);
}
// let data = await manageProducts({}, 'read')
// data.result.map((product,i) => {
//     const url = productCommonUrl(product.link);
//     data.result[i].link = url
// })
// fs.writeFileSync('updated.json', JSON.stringify(data.result));
// const data = fs.readFileSync('updated.json').toString();
// let products = JSON.parse(data);
// let arr = [];
// const duplicate = products.filter(product => {
//     const same = products.filter(p => {
//         return p.link === product.link
//     })
//     const users = same.map((p) => ({ userId: p.userId, tracking_id: p.tracking_id}));
//     arr.push({
//         link: product.link,
//         merchant: product.merchant,
//         initPrice: product.initPrice,
//         price: product.price,
//         title: product.title,
//         users

//     })
//     // same.map((p, index) => {
//     //     delete products[index]
//     // })
// }) 
// fs.writeFileSync('duplicate.json', JSON.stringify(arr));

// (async () => await func())()
const deleteData = async () => {
  await connectDb();
  const db = mongo.db('TESTS').collection('tasks')
  await db.deleteOne({users: null})
}
(async () => await deleteData())()