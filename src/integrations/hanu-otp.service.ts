const sendOtp = async (
    mobileNumber: string,
    otp: string
) => {
    const params = new URLSearchParams({
        number: mobileNumber,
        OTP: otp,
        apikey: process.env.HANU_API_KEY!,
        templatesid: "default",
    });

    const response = await fetch(
        `https://api.hanuotp.in/sms-otp.php?${params.toString()}`
    );

    if (!response.ok) {
        throw new Error(
            `HanuOTP request failed with status ${response.status}`
        );
    }

    const body = await response.text();

    console.log("HanuOTP response:", body);

    return body;
};

export default {
    sendOtp,
};