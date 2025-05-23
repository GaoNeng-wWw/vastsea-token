import { JwtModule } from '@app/jwt';
import { PrismaModule, PrismaService } from '@app/prisma';
import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { PermissionModule } from './permission/permission.module';
import { ClusterModule, RedisModule } from '@liaoliaots/nestjs-redis';
import { ConfigModule, ConfigService, tomlLoader } from '@app/config';
import { join } from 'path';
import { GlobalCounterModule, GlobalCounterService } from '@app/global-counter';
import { APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { RoleModule } from './role/role.module';
import { RedisCacheModule } from '@app/redis-cache';
import { AuthModule } from './auth/auth.module';
import { readFileSync } from 'fs';
import { SuperSerializerInterceptor } from './super_serializer/super_serializer.interceptor';
import { ClientModule } from './client/client.module';
import { AuthGuard } from '@app/guard';
import { PermissionGuard } from '../libs/guard/src/permission-guard';
import { AccountModule } from './account/account.module';
import { PermissionService } from './permission/permission.service';
import { RoleService } from './role/role.service';
import { AccountService } from './account/account.service';
import { randomBytes } from 'crypto';
import { AutoRedis } from '@app/decorator';
import Redis, { Cluster } from 'ioredis';
import { ID_COUNTER } from '@app/constant';
import { ZodValidationPipe } from 'nestjs-zod';
import { RequireClientPairGuard } from '@app/guard';
import { ClientService } from './client/client.service';
import { RequriedClientAdministratorGuard } from '@app/guard/require-client-administrator';

const BUILT_IN_PERMISSIONS = [
  '*',
  'CLIENT::GET::LIST',
  'CLIENT::GET::INFO',
  'CLIENT::CREATE',
  'CLIENT::REMOVE',
  'CLIENT::UPDATE',
  'ROLE::CREATE',
  'ROLE::REMOVE',
  'ROLE::UPDATE',
  'ROLE::GET::INFO',
  'ROLE::GET::LIST',
  'AUTH-SERVER::LOGIN',
];

@Module({
  imports: [
    PrismaModule,
    JwtModule.forRoot({
      global: true,
      priKey: readFileSync(join(__dirname, '../keys/pri.pkcs8')).toString(),
      pubKey: readFileSync(join(__dirname, '../keys/pub.pem')).toString(),
      keyPairType: 'RS256',
    }),
    ConfigModule.forRoot({
      loader: tomlLoader(
        join(
          __dirname,
          process.env.CI ? '../config.test.toml' : '../config.toml',
        ),
      ),
      global: true,
    }),
    process.env.REDIS_CLUSTER
      ? ClusterModule.forRootAsync(
          {
            inject: [ConfigService],
            useFactory(config: ConfigService) {
              return {
                config: config.get('redis.cluster'),
              };
            },
          },
          true,
        )
      : RedisModule.forRootAsync(
          {
            inject: [ConfigService],
            useFactory(config: ConfigService) {
              return {
                config: config.get('redis.standalone'),
              };
            },
          },
          true,
        ),
    ClientModule,
    PermissionModule,
    GlobalCounterModule.forRoot({ global: true }),
    RedisCacheModule.forRoot({ global: true }),
    RoleModule,
    AccountModule,
    AuthModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SuperSerializerInterceptor,
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RequireClientPairGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RequriedClientAdministratorGuard,
    },
  ],
})
export class AppModule implements OnModuleInit {
  private appName: string = process.env.APP_NAME ?? 'Vastsea Token';
  private logger: Logger = new Logger(this.appName);
  constructor(
    private permission: PermissionService,
    private role: RoleService,
    private account: AccountService,
    private prisma: PrismaService,
    private cnt: GlobalCounterService,
    private client: ClientService,
    @AutoRedis() private redis: Redis | Cluster,
  ) {}
  async onModuleInit() {
    const installed = await this.redis.get(`SITE::LOCK`);
    if (installed) {
      this.logger.log(
        `${this.appName} look like initialization has been completed`,
      );
      this.logger.log(
        `If you want re install, please remove 'SITE::LOCK' in redis and drop database`,
      );
      return;
    }
    const password = __TEST__
      ? 'admin'
      : (process.env.ADMIN_PWD ??
        randomBytes(128).toString('base64').slice(0, 16));
    const email = process.env.ADMIN_EMAIL ?? 'admin@no-reply.com';
    const dbAdmin = await this.prisma.account.findFirst({
      where: {
        email,
      },
    });
    let dbAdminId = dbAdmin?.id;
    if (!dbAdmin) {
      dbAdminId = (
        await this.account.createAccount({
          email,
          password,
          profile: {
            nick: 'Admin',
          },
        })
      ).id;
    }
    console.clear();
    this.logger.log('管理员创建成功');
    const client = !__TEST__
      ? await this.client.createClient({
          name: 'AuthServer',
          redirect: process.env.REDIRECT,
          administrator: [dbAdminId],
        })
      : await this.prisma.client.create({
          data: {
            id: await this.redis.incr(ID_COUNTER.CLIENT),
            name: 'AuthServer',
            redirect: process.env.REDIRECT,
            administrator: {
              connect: {
                id: dbAdminId,
              },
            },
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
          },
        });
    for (const p of BUILT_IN_PERMISSIONS) {
      await this.permission.createPermission(
        {
          name: p,
          desc: p,
          active: true,
          clientId: client.clientId,
        },
        dbAdminId,
        true,
      );
      this.logger.log(`创建权限 ${p} 成功`);
    }
    const superPermission = await this.prisma.permission.findFirst({
      where: { name: '*' },
    });
    const role = await this.role.createRole({
      name: 'Admin',
      permissions: [superPermission.id],
      clientId: client.clientId,
      desc: '',
    });
    await this.prisma.account.update({
      where: {
        id: dbAdminId,
      },
      data: {
        role: {
          connect: {
            id: role.id,
          },
        },
      },
    });
    await this.redis.set(`SITE::LOCK`, new Date().toLocaleDateString());
    await this.redis.hset(`SITE::META`, client);
    this.logger.log('-----Welcome Vastsea AuthServer!-----');
    this.logger.log(`AdminEmail: ${email}`);
    this.logger.log(`AdminPassword: ${password}`);
    this.logger.log(`---------------------------`);
    this.logger.log(`ClientId: ${client.clientId}`);
    this.logger.log(`ClientId: ${client.clientSecret}`);
    this.logger.log(`---------------------------`);
  }
}
