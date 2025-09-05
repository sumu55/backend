import { Router } from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { getDb } from './db';
import { 
  apiPayments, 
  userApiKeys, 
  apiPlans,
  insertApiPaymentSchema,
  selectApiPaymentSchema
} from '@shared/schema';
import { eq, and } from 'drizzle-orm';

const router = Router();

// Initialize Razorpay with test credentials
const razorpay = new Razorpay({
  key_id: 'rzp_test_9DhYJGgGhKgKXx', // Replace with your test key
  key_secret: 'Ize6H203q2KF5ZUOI4880iPp', // Replace with your test secret
});

// Create payment order
router.post('/create-order', async (req, res) => {
  try {
    const { planId, amount } = req.body;
    const userToken = req.userToken; // From user tracking middleware

    if (!planId || !amount) {
      return res.status(400).json({ error: 'Plan ID and amount are required' });
    }

    const db = getDb();

    // Verify plan exists
    const plan = await db.select()
      .from(apiPlans)
      .where(eq(apiPlans.id, planId))
      .limit(1);

    if (plan.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Verify amount matches plan price
    const expectedAmount = Math.round(plan[0].price * 100); // Convert to paise
    if (amount !== expectedAmount) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    // Create Razorpay order
    const options = {
      amount: amount, // amount in paise
      currency: 'INR',
      receipt: `receipt_${Date.now()}`,
      notes: {
        planId: planId,
        userToken: userToken,
        planName: plan[0].name,
      }
    };

    const order = await razorpay.orders.create(options);
    
    console.log('✅ Razorpay order created:', order.id);

    // Store payment record in database
    const paymentData = {
      userToken,
      planId,
      orderId: order.id,
      amount: plan[0].price,
      currency: 'INR',
      status: 'pending',
    };

    const validatedPayment = insertApiPaymentSchema.parse(paymentData);
    await db.insert(apiPayments).values(validatedPayment);

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      planName: plan[0].name,
    });

  } catch (error) {
    console.error('❌ Error creating payment order:', error);
    res.status(500).json({ error: 'Failed to create payment order' });
  }
});

// Verify payment
router.post('/verify', async (req, res) => {
  try {
    const { orderId, paymentId, signature, planId } = req.body;
    const userToken = req.userToken;

    if (!orderId || !paymentId || !signature || !planId) {
      return res.status(400).json({ error: 'Missing payment verification data' });
    }

    const db = getDb();

    // Verify signature
    const generatedSignature = crypto
      .createHmac('sha256', 'YourTestKeySecret') // Replace with your test secret
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    if (generatedSignature !== signature) {
      console.error('❌ Payment signature verification failed');
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // Get payment record
    const payment = await db.select()
      .from(apiPayments)
      .where(and(
        eq(apiPayments.orderId, orderId),
        eq(apiPayments.userToken, userToken)
      ))
      .limit(1);

    if (payment.length === 0) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    // Get plan details
    const plan = await db.select()
      .from(apiPlans)
      .where(eq(apiPlans.id, planId))
      .limit(1);

    if (plan.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Update payment status
    await db.update(apiPayments)
      .set({
        paymentId,
        signature,
        status: 'completed',
        paidAt: new Date(),
      })
      .where(eq(apiPayments.id, payment[0].id));

    // Create API key for user
    const apiKey = `ak_${crypto.randomBytes(24).toString('hex')}`;
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month from now

    await db.insert(userApiKeys).values({
      userToken,
      keyHash: crypto.createHash('sha256').update(apiKey).digest('hex'),
      planId,
      expiryDate,
      isActive: true,
    });

    console.log('✅ Payment verified and API key created for user:', userToken);

    res.json({
      success: true,
      message: 'Payment successful! Your API key has been generated.',
      apiKey,
      planName: plan[0].name,
      expiryDate,
    });

  } catch (error) {
    console.error('❌ Error verifying payment:', error);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

// Get payment history for user
router.get('/history', async (req, res) => {
  try {
    const userToken = req.userToken;
    const db = getDb();

    const payments = await db.select({
      id: apiPayments.id,
      amount: apiPayments.amount,
      currency: apiPayments.currency,
      status: apiPayments.status,
      createdAt: apiPayments.createdAt,
      paidAt: apiPayments.paidAt,
      planName: apiPlans.name,
    })
    .from(apiPayments)
    .leftJoin(apiPlans, eq(apiPayments.planId, apiPlans.id))
    .where(eq(apiPayments.userToken, userToken))
    .orderBy(apiPayments.createdAt);

    res.json({ payments });

  } catch (error) {
    console.error('❌ Error fetching payment history:', error);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// Get current subscription status
router.get('/subscription', async (req, res) => {
  try {
    const userToken = req.userToken;
    const db = getDb();

    const subscription = await db.select({
      planName: apiPlans.name,
      planPrice: apiPlans.price,
      requestLimit: apiPlans.requestLimit,
      expiryDate: userApiKeys.expiryDate,
      isActive: userApiKeys.isActive,
      createdAt: userApiKeys.createdAt,
    })
    .from(userApiKeys)
    .leftJoin(apiPlans, eq(userApiKeys.planId, apiPlans.id))
    .where(and(
      eq(userApiKeys.userToken, userToken),
      eq(userApiKeys.isActive, true)
    ))
    .orderBy(userApiKeys.createdAt)
    .limit(1);

    if (subscription.length === 0) {
      return res.json({ hasSubscription: false });
    }

    const sub = subscription[0];
    const isExpired = new Date() > new Date(sub.expiryDate);

    res.json({
      hasSubscription: true,
      isExpired,
      subscription: {
        planName: sub.planName,
        planPrice: sub.planPrice,
        requestLimit: sub.requestLimit,
        expiryDate: sub.expiryDate,
        createdAt: sub.createdAt,
      },
    });

  } catch (error) {
    console.error('❌ Error fetching subscription:', error);
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

export default router;