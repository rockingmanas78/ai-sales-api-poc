const Razorpay = require('razorpay');
const crypto = require('crypto');

const instance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});



exports.createOrder = async (req, res) => {
    const options = {
        amount: req.body.amount * 100, // Razorpay expects amount in paise
        currency: 'INR',
        receipt: `txn_${Date.now()}`
    };
    try {
        const order = await instance.orders.create(options);
        res.json({ order });
    } catch (err) {
        res.status(500).json({ error: 'Order creation failed' });
    }
};


exports.verifyPayment = async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                           .update(body).digest('hex');

    if (expected === razorpay_signature) {
             
    
            res.json({ success: true, message: "Payment Successfull" });
             
    } 
    else {
        res.status(400).json({ error: 'Invalid signature' });
    }
};