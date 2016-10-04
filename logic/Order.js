/**
 * Created by pariskshitdutt on 26/07/16.
 */
var q = require('q');

var jwt = require('jwt-simple');
var ObjectId = require('mongoose').Types.ObjectId;
var moment = require('moment');
var async = require('async');
var db = require('../db/DbSchema');
var events = require('../events');
var crypto2 = require('crypto');
var config = require('config');
var log = require('tracer').colorConsole(config.get('log'));
var apn = require('../notificationSenders/apnsender');
var gcm = require('../notificationSenders/gcmsender');
var crypto = require('../authentication/crypto');
var bcrypt = require('bcrypt');

var restaurantTable = db.getrestaurantdef;
var userTable = db.getuserdef;
var orderTable = db.getorderdef;
var paymentTable = db.getpaymentdef;
var areaTable = db.getareadef;
var couponTable = db.getcoupondef;
var orderLogic = {
    findCity: function (req) {
        var def = q.defer();
        areaTable.find().distinct('city', function (err, cities) {
            if (!err) {
                def.resolve(cities);
            } else {
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        });
        return def.promise;
    },
    findLocalities: function (req) {
        var def = q.defer();
        areaTable.find({city: req.query.city}).distinct('locality', function (err, localities) {
            if (!err) {
                def.resolve(localities);
            } else {
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        });
        return def.promise;
    },
    findArea: function (req) {
        var def = q.defer();
        areaTable.find({city: req.query.city}).distinct('area', function (err, area) {
            if (!err) {
                def.resolve(area);
            } else {
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        });
        return def.promise;
    },
    findServicingRestaurant: function (req) {
        var def = q.defer();
        areaTable.findOne({
            city: req.query.city,
            area: req.query.area,
        }, "serviced_by", function (err, area) {
            log.info(err, area);
            if (!err && area) {
                log.info(area);
                def.resolve(area.serviced_by);
            } else {
                log.info(err);
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        });
        return def.promise;
    },
    combineRestaurant: function (req, restaurants) {
        var def = q.defer();
        restaurantTable.find({
            name: {$in: restaurants},
            is_deleted: false,
            is_verified: true
        }, "name dishes open_status contact_name contact_number", function (err, restaurants) {
            log.info(err, restaurants);
            if (!err && restaurants.length > 0) {
                var response = {};
                response.contact_name = restaurants[0].contact_name;
                response.contact_number = restaurants[0].contact_number;
                response.dishes = [];

                for (var i = 0; i < restaurants.length; i++) {
                    for (var j = 0; j < restaurants[i].dishes.length; j++) {
                        response.dishes.push(restaurants[i].dishes[j]);
                    }
                }
                log.info(response.dishes);
                def.resolve(response);
            } else {
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        });
        return def.promise;
    },
    findRestaurantFromArea: function (req) {
        var def = q.defer();
        areaTable.findOne({
            city: req.body.city,
            area: req.body.area,
        }, "serviced_by", function (err, area) {
            if (!err && area) {
                def.resolve(area.serviced_by);
            } else {
                log.info(err);
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        });
        return def.promise;
    },
    findActualRates: function (req, restaurants) {
        var def = q.defer();
        restaurantTable.find({
            name: {$in: restaurants},
            is_deleted: false,
            is_verified: true
        }, "dishes name delivery_enabled open_status", function (err, restaurants) {
            if (!err && restaurants) {
                // if (restaurant.open_status) {
                def.resolve(restaurants);
                // } else {
                //     def.reject({status: 200, message: config.get("error.closed")})
                // }
            } else {
                // log.info(err,restaurants);
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        });
        return def.promise;
    },
    createDishesOrderedList: function (req, restaurants) {
        var def = q.defer();
        log.info(restaurants);
        var dishes_ordered = [];
        if (Object.keys(req.body.dishes_ordered).length == 0) {
            log.info("here bhi")
            def.reject({status: 400, message: config.get('error.badrequest')});
        }
        var completeDishList = []
        for (var i = 0; i < restaurants.length; i++) {
            for (var j = 0; j < restaurants[i].dishes.length; j++) {
                var dish = restaurants[i].dishes[j]
                // restaurants[i].dishes=restaurants[i].dishes.toObject();
                dish = dish.toObject();
                dish.res_name = restaurants[i].name;
                completeDishList.push(dish)
            }
        }
        // log.info(completeDishList);
        for (var i = 0; i < completeDishList.length; i++) {
            // log.info(req.body.dishes_ordered[completeDishList[i].identifier]);
            if (req.body.dishes_ordered[completeDishList[i].identifier]) {

                if (
                    completeDishList[i].availability &&
                    req.body.dishes_ordered[completeDishList[i].identifier].qty > 0 &&
                    req.body.dishes_ordered[completeDishList[i].identifier].qty < 10 &&
                    req.body.dishes_ordered[completeDishList[i].identifier].price > 0
                ) {
                    log.info("here");
                    dishes_ordered.push({
                        identifier: completeDishList[i].identifier,
                        price_recieved: completeDishList[i].price_to_consumer,
                        price_to_pay: completeDishList[i].price,
                        qty: req.body.dishes_ordered[completeDishList[i].identifier].qty,
                        res_name: completeDishList[i].res_name
                    });
                    log.info(dishes_ordered);
                } else {
                    log.info("here");
                    def.reject({status: 400, message: config.get('error.badrequest')});
                }
            }
        }
        log.info(dishes_ordered);

        if (dishes_ordered.length == Object.keys(req.body.dishes_ordered).length) {
            var dishesByRestaurant = {};
            for (var i = 0; i < dishes_ordered.length; i++) {
                if (dishesByRestaurant[dishes_ordered[i].res_name]) {
                    dishesByRestaurant[dishes_ordered[i].res_name].push(dishes_ordered[i]);
                } else {
                    dishesByRestaurant[dishes_ordered[i].res_name] = [];
                    dishesByRestaurant[dishes_ordered[i].res_name].push(dishes_ordered[i]);
                }
            }
            // log.info(dishesByRestaurant);
            def.resolve({dishes_ordered: dishesByRestaurant, restaurant: restaurants});
        } else {
            log.info("here");
            def.reject({status: 400, message: config.get('error.badrequest')});
        }
        return def.promise;
    },
    saveOrder: function (req, dishes_ordered, restaurants) {
        var def = q.defer();
        // log.info(dishes_ordered);
        var location = [0, 0];
        if (req.body.lat && req.body.lon) {
            try {
                location = [Number(req.body.lon), Number(req.body.lat)];
            } catch (err) {

            }
        }
        var source = {
            name: "website",
            id: false
        }
        if (req.body.source) {
            source.name = req.body.source.name;
            source.id = req.body.source.id;
        }
        var status = "awaiting response"
        if (req.body.status) {
            status = req.body.status;
        }
        // log.info(source);

        var delivery_price_recieved = 0;
        var delivery_price_to_pay = 0;

        for (var i = 0; i < restaurants.length; i++) {
            if (dishes_ordered[restaurants[i].name]) {
                for (var j = 0; j < dishes_ordered[restaurants[i].name].length; j++) {
                    var dish = dishes_ordered[restaurants[i].name][j];
                    delivery_price_recieved += (dish.price_recieved * dish.qty);
                    delivery_price_to_pay += (dish.price_to_pay * dish.qty);
                }
            }
        }
        log.info(req.body.coupon_code);
        if (req.body.coupon_code && req.body.coupon_code.off) {
            delivery_price_recieved = (delivery_price_recieved * (100 - Number(req.body.coupon_code.off)) / 100);
        }
        var ordersList = [];
        // log.info(order_completed);
        var full_order = false;

        var _restaurants = []
        for (var i = 0; i < restaurants.length; i++) {
            if (dishes_ordered[restaurants[i].name]) {
                _restaurants.push(restaurants[i]);
            }
        }
        restaurants = _restaurants;
        if (restaurants.length == 1) {
            full_order = true;
        }
        var order_completed = restaurants.length;
        var combined_id = Math.floor(Math.random() * 90000) + 10000;
        for (var i = 0; i < restaurants.length; i++) {
            log.info(dishes_ordered[restaurants[i].name]);
            if (dishes_ordered[restaurants[i].name]) {
                if (restaurants[i].open_status) {
                    if (Object.keys(dishes_ordered).length > 1) {
                        if (i != 0) {
                            req.body.delivery_enabled = false;

                        } else {
                            req.body.delivery_enabled = true;
                        }
                    }
                    var total_price_recieved = 0;
                    var total_price_to_pay = 0;
                    dishes_ordered[restaurants[i].name].forEach(function (d) {
                        total_price_recieved += (d.price_recieved * d.qty);
                        total_price_to_pay += (d.price_to_pay * d.qty);
                    });

                    // log.info(total_price_recieved);
                    var order = new orderTable({
                        address: req.body.address,
                        payment_mode: req.body.payment_mode,
                        payment_status: req.body.payment_mode == 'cod' ? req.body.payment_status : 'pending',
                        area: req.body.area,
                        combined_id: combined_id,
                        full_order: full_order,
                        coupon: req.body.coupon_code,
                        locality: req.body.locality,
                        city: req.body.city,
                        location: location,
                        delivery: {
                            enabled: restaurants[i].delivery_enabled && req.body.delivery_enabled
                        },
                        total_price_recieved: total_price_recieved,
                        total_price_to_pay: total_price_to_pay,
                        delivery_price_recieved: delivery_price_recieved,
                        delivery_price_to_pay: delivery_price_to_pay,
                        customer_name: req.body.customer_name,
                        customer_number: req.body.customer_number,
                        customer_email: req.body.customer_email,
                        dishes_ordered: dishes_ordered[restaurants[i].name],
                        restaurant_assigned: restaurants[i].name,
                        status: status,
                        source: source
                    });
                    order.save(function (err, order, info) {
                        order_completed--;
                        if (!err) {
                            ordersList.push(order);
                            if (order_completed == 0) {
                                if (ordersList.length < restaurants.length) {
                                    def.reject({status: 500, message: config.get('error.dberror')});
                                    for (var l = 0; l < ordersList.length; l++) {
                                        log.info("removing order")
                                        orderTable.remove({_id: ordersList[l]}, function (err, info) {
                                        })
                                    }
                                } else {

                                    //payu
                                    console.log('/getShaKey');
                                    var shasum = crypto2.createHash('sha512');
                                    var txnid = '#txnid' + combined_id;
                                    var dataSequence = config.payu.key
                                        + '|' + txnid
                                        + '|' + parseFloat(parseFloat(delivery_price_recieved).toFixed(2))
                                        + '|' + 'food'
                                        + '|' + req.body.customer_name
                                        + '|' + req.body.customer_email
                                        + '|||||||||||'
                                        + config.payu.salt;
                                    var resultKey = shasum.update(dataSequence).digest('hex');
                                    console.log(dataSequence);
                                    console.log(resultKey);

                                    def.resolve({
                                        id: combined_id,
                                        key: config.payu.key,
                                        hash: resultKey,
                                        txnid: txnid,
                                        firstname: req.body.customer_name,
                                        email: req.body.customer_email,
                                        phone: req.body.customer_number,
                                        payu_url: config.payu.url,
                                        surl: config.base_url + '/api/v1/order/paymentstatus/success/' + combined_id,
                                        furl: config.base_url + '/api/v1/order/paymentstatus/failed/' + combined_id,
                                        price: parseFloat(parseFloat(delivery_price_recieved).toFixed(2))
                                    });

                                    log.info("sending mail", order._id);
                                    orderLogic.createMail(order);
                                }
                            }
                        } else {
                            log.info(err);
                            if (order_completed == 0) {
                                def.reject({status: 500, message: config.get('error.dberror')});
                                for (var l = 0; l < ordersList.length; l++) {
                                    orderTable.remove({_id: ordersList[l]}, function (err, info) {

                                    })
                                }
                            }
                        }
                    });
                } else {
                    order_completed--;
                    log.info("restaurant closed");
                    def.reject({status: 500, message: config.get('error.dberror')});

                }

            } else {
                order_completed--;
                log.info("restaurant not used");
            }
        }

        return def.promise;
    },
    createMail: function (order) {

        var customerEmail = "<p>Your Zasty Order has been placed.</p><br>"
            + "<br>Order Id: <b>" + order.combined_id
            + '</b></p><br><br><br>';
        order.dishes_ordered.forEach(function (d) {
            customerEmail += "<p>Qty:" + d.qty + " - Dish:" + d.identifier + "<p><br>";
        });
        customerEmail += '<br/><br/>Total Price: ' + order.total_price_recieved;
        customerEmail += '<br/><br/>Thank You for ordering from Zasty.';

        var email = {
            subject: "Zasty Order - ID - " + order.combined_id,
            message: customerEmail,
            plaintext: customerEmail
        };

        email.toEmail = order.customer_email;
        events.emitter.emit("mail", email);

        var message = "<b>new order</b> id- " + order._id + '<br>';
        order.dishes_ordered.forEach(function (d) {
            message += "<p>qty: " + d.qty + " - Dish: " + d.identifier + " - Price: " + d.price_to_pay + "<p><br>";
        });
        message += '\ntotal price to restaurant: ' + order.total_price_to_pay;

        email = {
            subject: "New Order ID - " + order._id,
            message: message,
            plaintext: message
        };

        userTable.findOne({restaurant_name: order.restaurant_assigned}, function (err, doc) {
            if (doc && doc.email) {
                if (doc.phonenumber) {
                    var message = "new order\n"
                    order.dishes_ordered.forEach(function (d) {
                        message += d.qty + "-" + d.identifier + ":" + d.price_to_pay + "\n";
                    });
                    log.info("sending sms");
                    events.emitter.emit("sms", {number: doc.phonenumber, message: message})
                }
                email.toEmail = doc.email;
                events.emitter.emit("mail", email);
            }
        });

        email.message += '<br>total price: ' + order.total_price_recieved;
        email.plaintext += '<br>total price: ' + order.total_price_recieved;

        events.emitter.emit("mail_admin", email);
    },
    deleteOrder: function (req) {
        var def = q.defer();
        orderTable.update({_id: req.body.order_id},
            {$set: {is_deleted: true}}, function (err, info) {
                if (!err) {
                    def.resolve(config.get("ok"));
                } else {
                    def.reject({status: 500, message: config.get('error.dberror')});
                }
            });
        return def.promise;
    },
    getcoupon: function (req, name) {
        var def = q.defer();
        if (name) {
            couponTable.findOne({name: name, is_active: true}, "name off", function (err, coupon) {
                if (!err) {
                    if (coupon) {
                        def.resolve(coupon);
                    } else {
                        def.resolve({});
                    }
                } else {
                    def.reject({status: 500, message: config.get('error.dberror')});

                }
            })
        } else {
            def.resolve({});
        }
        return def.promise;
    },
    saveAddress: function (req) {
        var def = q.defer();
        var address = {
            address: req.body.address,
            area: req.body.area,
            locality: req.body.locality,
            city: req.body.city,
        };
        userTable.update({email: req.body.customer_email}, {$addToSet: {address: address}}, function (err, info) {
            if (!err) {
                def.resolve("saved address");
            } else {
                def.reject({status: 500, message: config.get('error.dberror')});
            }
        })
        return def.promise;
    },
    deliveryCallback: function (req) {
        var def = q.defer();

        orderTable.findOne({_id: req.params.order_id}, function (err, doc) {
            if (err || !doc) {
                def.reject({status: 500, message: config.get('error.dberror')});
            }

            doc.delivery.log.push({status: JSON.stringify(req.body)});

            if (req.body.order_status == 'DELIVERED') {
                doc.status = req.body.order_status;
            }

            doc.delivery.status = req.body.order_status;

            if (parseInt(req.body.cancel_reason) > -1) {
                doc.status = 'DELIVERY_ERROR';
                var text = "order delivery service issue for order id-" + doc._id + ' r- ' + JSON.stringify(req.body);
                events.emitter.emit("mail_admin", {
                    subject: "Order Delivery Issue",
                    message: text,
                    plaintext: text
                });
            }
            doc.save();
            def.resolve(doc);
        });
        return def.promise;
    },
    paymentCallback: function (req) {
        var def = q.defer();
        var pay = new paymentTable({
            params: req.params,
            status: req.params.status,
            order_id: req.params.order_id,
            body: req.body
        });
        pay.save(function (err, doc) {
            console.log(pay);
            if (err) {
                console.log(err, pay);
                return def.reject();
            }
            if (req.params.status === 'success') {
                orderTable.update(
                    {combined_id: req.params.order_id},
                    {
                        payment_status: req.body.status,
                        payment_mihpayid: req.body.mihpayid,
                        payment_id: req.body.txnid
                    },
                    {multi: true},
                    function (err, info) {
                        if (!err) {
                            def.resolve(doc);
                        } else {
                            def.reject();
                        }
                    });
            } else {

                var text = "Order Payment Fail -" + "\n" + JSON.stringify(req.body, null, '\t')
                    + "\n" + JSON.stringify(req.params, null, '\t');

                var email = {
                    subject: "Payu Payment Failed for Combined Order ID: " + req.params.order_id,
                    message: text,
                    plaintext: text
                };
                events.emitter.emit("mail_admin", email);

            }
        });
        return def.promise;
    }
};

module.exports = orderLogic;