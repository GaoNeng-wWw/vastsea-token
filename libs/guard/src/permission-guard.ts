import { PermissionArgs } from '@app/decorator';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionService } from '../../../src/permission/permission.service';
import { PERMISSION_KEY } from '@app/constant';
import { permissionJudge } from '../../decorator/src/permission-judge';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly permission: PermissionService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions: PermissionArgs =
      this.reflector.getAllAndOverride(PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
    if (!requiredPermissions) {
      return true;
    }
    if (Array.isArray(requiredPermissions) && !requiredPermissions.length) {
      return true;
    }
    const req: AuthReq = context.switchToHttp().getRequest();
    const {
      user: { id },
    } = req;
    const permissions = await this.permission.getAccountPermission(
      BigInt(id),
      process.env.CLIENT_ID,
    );
    req.user = {
      ...req.user,
      permissions,
      super: permissions.includes('*'),
    };
    if (permissions.includes('*')) {
      return true;
    }
    if (
      Array.isArray(requiredPermissions) &&
      requiredPermissions.length > permissions.length
    ) {
      throw new HttpException(`权限不足`, HttpStatus.FORBIDDEN);
    }
    if (
      Array.isArray(requiredPermissions) &&
      requiredPermissions.every((permission) =>
        permissions.includes(permission),
      )
    ) {
      return true;
    }
    if (
      !Array.isArray(requiredPermissions) &&
      permissionJudge(permissions, requiredPermissions)
    ) {
      return true;
    }
    throw new HttpException('权限不足', HttpStatus.FORBIDDEN);
  }
}
