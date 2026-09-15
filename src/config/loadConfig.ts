import { ConfigSchema, AppConfig } from './schema';

export function loadConfig(): AppConfig {
  const raw = {
    app: {
      name: 'WorkShopBackendWithoutPart',
      env: process.env.NODE_ENV ?? 'development',
      port: parseInt(process.env.PORT ?? '3000', 10),
      host: process.env.HOST ?? '0.0.0.0',
      frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    },
    database: {
      url: process.env.DATABASE_URL ?? '',
    },
    security: {
      jwtSecret: process.env.JWT_SECRET ?? 'workshop-jwt-secret-change-in-production',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    },
    storage: {
      useLocal: process.env.USE_LOCAL_STORAGE === 'true',
      uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
      maxFileSize: parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10),
      s3Bucket: process.env.AWS_S3_BUCKET ?? '',
      s3Region: process.env.AWS_S3_REGION ?? 'ap-south-1',
      s3Endpoint: process.env.AWS_S3_ENDPOINT ?? '',
      s3AccessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      s3SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    },
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT ?? '587', 10),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
      from: process.env.SMTP_FROM,
    },
    whatsapp: {
      phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    },
    evolve: {
      apiUrl: process.env.EVOLVE_API_URL ?? 'https://intu.automate.co.za/wsesIRM/Service.asmx/EvolveRequestAction',
      interfaceCode: process.env.EVOLVE_INTERFACE_CODE ?? '95112-ELT-70EC',
      sourceSystem: process.env.EVOLVE_SOURCE_SYSTEM ?? 'Evolve',
      targetSystem: process.env.EVOLVE_TARGET_SYSTEM ?? 'WMS',
      messageCreator: process.env.EVOLVE_MESSAGE_CREATOR ?? 'WMS',
    },
    ai: {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    },
  };

  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('Invalid configuration:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}
